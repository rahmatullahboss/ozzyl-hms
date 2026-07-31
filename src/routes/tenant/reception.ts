import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { bills } from '../../db/schema';
import { getNextSequence } from '../../lib/sequence';
import { buildLocalSyncPatientCreateOutboxStatement } from '../../lib/local-sync-outbox';
import { buildLocalSyncPatientPayload } from '../../lib/local-sync-patient-payload';
import { getNextBillInvoiceNumber } from '../../lib/invoice-sequence';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getCache, setCache } from '../../lib/cache';
import { accrueLabOrderDoctorCommissions } from '../../lib/lab-finance';
import { calculateBillCategoryTotals } from '../../lib/billing-category-totals';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { isRoleAllowed } from '../../lib/authz';
import { requireRole } from '../../middleware/rbac';
import {
  ensureDoctorDailyStatusTable,
  hasDoctorTimelineConflict,
  type DoctorDailyStatusRow,
} from '../../lib/doctor-daily-status';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  postPendingAccountingEvents,
} from '../../lib/accounting-posting';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import { loadIpdAdmissionBillingSnapshot } from '../../lib/ipd-billing-summary';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';
import { resolveLabTestBillingRows } from '../../lib/diagnostic-catalog';
import { resolveOrderingClinicianDoctorId } from '../../lib/lab-order-attribution';
import { assertDiscountReferralNameForHighDiscount } from '../../lib/discount-policy';
import { buildTokenReservationAvailability } from '../../lib/token-reservations';
import { discountAllocationTypeForReason, normalizeDiscountReason, roundMoney } from '../../lib/discount_allocation';
import { evaluateBillingSchemeEligibility, recordBillingSchemeUsage } from '../../lib/billing-scheme-eligibility';
import { buildInvoiceSearchTerms, escapeLikeWildcards } from '../../lib/invoice-search';
import { allocateDiscountAcrossGrossAmounts, requireUniquePositiveIds } from '../../lib/reception-billing-integrity';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { toMinorUnits } from '../../lib/canonical/money';
import { createReceptionVisitBilling } from '../../lib/canonical/commands/create-reception-visit-billing';
import {
  executeReceptionVisitBillingOriginalLegacy,
  prepareReceptionVisitBillingStrictContext,
  prepareReceptionVisitBillingStrictStatements,
  ReceptionVisitBillingError,
  type ReceptionVisitBillingContext,
  type ReceptionVisitBillingPreparationInput,
} from '../../lib/canonical/reception-visit-billing';
import { buildLiveDepositProjection } from '../../lib/canonical/live-financial-projection';
import { ensureLiveAdmissionContinuity, normalizeLegacyAdmissionStartedAtUtc } from '../../lib/canonical/live-admission-continuity';
import { recordDeposit, type AdjustmentTenderType } from '../../lib/canonical/commands/apply-deposit';
import {
  isFinancialBatchAssertionError,
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../../lib/canonical/financial-batch-assertion';
import { summarizeRefundApprovalRequests } from '../../lib/invoice-refund-presentation';
import {
  CriticalReadShadowBatchError,
  observeReceptionPatientContextCriticalReads,
} from '../../lib/canonical/critical-read-consumer-adapters';

const receptionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
receptionRoutes.use('*', requireRole('reception', 'hospital_admin', 'md', 'director', 'manager'));

const DISCOUNT_APPROVAL_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

function canonicalAdmissionDepositTenderType(paymentMethod: string | null | undefined): AdjustmentTenderType {
  const normalized = String(paymentMethod ?? 'cash').trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (normalized === 'card') return 'card';
  if (['mobile_wallet', 'mobile banking', 'mobile_banking', 'bkash', 'nagad', 'rocket'].includes(normalized)) {
    return 'mobile_wallet';
  }
  if (['bank', 'bank_transfer', 'bank transfer', 'cheque', 'check'].includes(normalized)) return 'bank_transfer';
  if (['gateway', 'online'].includes(normalized)) return 'gateway';
  return 'other';
}

function queueReceptionAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post reception billing accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function isReceptionVisitCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical|mapping|idempotency|constraint|changed before|changed concurrently|strict financial/i.test(message)) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function assertReceptionDiscountAllowed(c: Context<{ Bindings: Env; Variables: Variables }>, amount: number | null | undefined): void {
  if (Number(amount ?? 0) > 0 && !isRoleAllowed(c.get('role'), DISCOUNT_APPROVAL_ROLES)) {
    throw new HTTPException(403, { message: 'Reception discounts require approval from an authorized finance/admin role' });
  }
}

type ReceptionMutationIdempotencyState = {
  key: string | null;
  mutationType: string;
  reserved: boolean;
  replay: Record<string, unknown> | null;
};

async function beginReceptionMutationIdempotency(input: {
  db: D1Database;
  tenantId: string;
  userId: string | number;
  mutationType: string;
  idempotencyKey?: string;
  payload: unknown;
  mismatchMessage: string;
  conflictMessage: string;
}): Promise<ReceptionMutationIdempotencyState> {
  if (!input.idempotencyKey) {
    return { key: null, mutationType: input.mutationType, reserved: false, replay: null };
  }

  const requestHash = await createIdempotencyRequestHash(input.payload);
  const replay = await readMutationIdempotencyReplay(input.db, {
    tenantId: input.tenantId,
    mutationType: input.mutationType,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    mismatchMessage: input.mismatchMessage,
    conflictMessage: input.conflictMessage,
  });
  if (replay) {
    return {
      key: input.idempotencyKey,
      mutationType: input.mutationType,
      reserved: false,
      replay: replay.responseBody,
    };
  }

  const reservedReplay = await reserveMutationIdempotencyKey(input.db, {
    tenantId: input.tenantId,
    mutationType: input.mutationType,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    createdBy: input.userId,
    mismatchMessage: input.mismatchMessage,
    conflictMessage: input.conflictMessage,
  });
  return {
    key: input.idempotencyKey,
    mutationType: input.mutationType,
    reserved: !reservedReplay,
    replay: reservedReplay?.responseBody ?? null,
  };
}

async function completeReceptionMutationIdempotency(
  db: D1Database,
  tenantId: string,
  state: ReceptionMutationIdempotencyState,
  sourceId: string | number,
  responseBody: Record<string, unknown>,
): Promise<void> {
  if (!state.key || !state.reserved) return;
  await completeMutationIdempotencyKey(db, {
    tenantId,
    mutationType: state.mutationType,
    idempotencyKey: state.key,
    sourceId,
    responseBody,
  });
}

async function failReceptionMutationIdempotency(
  db: D1Database,
  tenantId: string,
  state: ReceptionMutationIdempotencyState,
): Promise<void> {
  if (!state.key || !state.reserved) return;
  await markMutationIdempotencyKeyFailed(db, {
    tenantId,
    mutationType: state.mutationType,
    idempotencyKey: state.key,
  }).catch((error) => console.error(`Failed to mark ${state.mutationType} idempotency key failed:`, error));
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════════

const mutationIdempotencyKeySchema = z.string().trim().min(8).max(128).optional();

const addServiceSchema = z.object({
  serviceItemId: z.number().int().positive(),
  doctorId: z.number().int().optional(),
  quantity: z.number().int().positive().default(1),
  discountAmount: z.number().min(0).default(0),
  description: z.string().optional(),
  idempotencyKey: mutationIdempotencyKeySchema,
});

const addBulkServicesSchema = z.object({
  serviceItemIds: z.array(z.number().int().positive()).min(1),
  doctorId: z.number().int().optional(),
  quantity: z.number().int().positive().default(1),
  discountAmount: z.number().min(0).default(0),
  idempotencyKey: mutationIdempotencyKeySchema,
});

const addLabServiceSchema = z.object({
  labTestIds: z.array(z.number().int().positive()).min(1),
  discountAmount: z.number().min(0).default(0),
  orderDate: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: mutationIdempotencyKeySchema,
});

const addProcedureSchema = z.object({
  serviceItemId: z.number().int().positive(),
  procedureName: z.string().min(1),
  instructions: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  discountAmount: z.number().min(0).default(0),
  idempotencyKey: mutationIdempotencyKeySchema,
});

const discountAllocationReasonSchema = z.enum(['normal_hospital_discount', 'poor_patient_charity', 'doctor_commission_waiver', 'management_approved', 'reference_discount', 'staff_benefit_discount', 'vip_benefit_discount', 'owner_benefit_discount', 'shareholder_benefit_discount', 'corporate_contract_discount', 'campaign_discount', 'rounding_adjustment']);

const discountAllocationSchema = z.object({
  reason: discountAllocationReasonSchema.default('normal_hospital_discount'),
  amount: z.number().min(0),
  doctorId: z.number().int().positive().optional(),
  note: z.string().trim().max(300).optional(),
});

const billingSchemeApplicationSchema = z.object({
  schemeId: z.number().int().positive().optional(),
  schemeCode: z.string().trim().max(80).optional(),
  memberCode: z.string().trim().max(80).optional(),
  memberId: z.number().int().positive().optional(),
  serviceCategory: z.string().trim().max(80).optional(),
  allocationType: discountAllocationReasonSchema.optional(),
  suggestedDiscount: z.number().min(0).optional(),
}).strict().refine((value) => Boolean(value.schemeId || value.schemeCode || value.memberCode || value.memberId), {
  message: 'Provide a scheme, member code, or member id',
});

const generateBillSchema = z.object({
  discount: z.number().min(0).default(0),
  discountByName: z.string().trim().max(200).optional(),
  discountAllocations: z.array(discountAllocationSchema).max(10).optional(),
  schemeApplication: billingSchemeApplicationSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const doctorStatusTypeEnum = z.enum(['available', 'on_leave', 'not_coming', 'scheduled', 'emergency_leave']);
const doctorTodayStatusSchema = z.object({
  isAvailable: z.boolean().optional(),
  statusType: doctorStatusTypeEnum.optional(),
  reason: z.string().trim().max(500).optional().nullable(),
  maxSerial: z.number().int().min(0).nullable().optional(),
});

const doctorBulkStatusSchema = z.object({
  updates: z.array(z.object({
    doctorId: z.number().int().positive(),
    isAvailable: z.boolean().optional(),
    statusType: doctorStatusTypeEnum.optional(),
    reason: z.string().trim().max(500).optional().nullable(),
    maxSerial: z.number().int().min(0).nullable().optional(),
  })).min(1),
});

// Sentinel for "always / indefinite" reservations. The UI exposes this as
// a single "Always" toggle; the database always has an explicit end date.
export const TOKEN_RESERVATION_ALWAYS_END_DATE = '2099-12-31';

export const createTokenReservationSchema = z.object({
  doctorId: z.number().int().positive().nullable().optional(),
  reservationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  tokenFrom: z.number().int().min(1),
  tokenTo: z.number().int().min(1),
  label: z.string().trim().max(200).optional().nullable(),
}).refine(d => !d.endDate || d.endDate >= d.reservationDate, {
  message: 'endDate must be on or after reservationDate',
  path: ['endDate'],
}).refine(d => d.tokenTo >= d.tokenFrom, {
  message: 'tokenTo must be >= tokenFrom',
  path: ['tokenTo'],
});

const updateTokenReservationSchema = z.object({
  tokenFrom: z.number().int().min(1).optional(),
  tokenTo: z.number().int().min(1).optional(),
  label: z.string().trim().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
}).refine(d => {
  if (d.tokenFrom !== undefined && d.tokenTo !== undefined) return d.tokenTo >= d.tokenFrom;
  return true;
}, {
  message: 'tokenTo must be >= tokenFrom',
  path: ['tokenTo'],
});

const quickAdmitSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  mobile: z.string().trim().max(20).optional(),
  age: z.number().int().positive().optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const admitWithDepositSchema = z.object({
  patientId: z.number().int().positive(),
  bedId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  admissionType: z.enum(['general', 'emergency', 'planned', 'transfer']).default('planned'),
  admitSource: z.enum(['opd_referral', 'emergency', 'planned', 'doctor_referral', 'self', 'transfer', 'walk_in', 'other']).optional(),
  referralDoctor: z.string().trim().max(200).optional(),
  admissionReason: z.string().trim().max(1000).optional(),
  provisionalDiagnosis: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  careOfName: z.string().trim().max(200).optional(),
  careOfPhone: z.string().trim().max(20).optional(),
  careOfRelation: z.string().trim().max(50).optional(),
  admissionFee: z.number().int().min(0).default(0),
  packageId: z.number().int().positive().optional(),
  billingMode: z.enum(['regular', 'package', 'package_plus_bed', 'package_included_days', 'corporate', 'emergency']).default('regular'),
  depositAmount: z.number().min(0).default(0),
  paymentMethod: z.string().trim().max(40).default('cash'),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

async function fetchServiceItems(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  serviceItemIds: number[],
): Promise<Map<number, Record<string, unknown>>> {
  const ids = [...new Set(serviceItemIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.$client.prepare(`
    SELECT *
    FROM billing_service_items
    WHERE tenant_id = ? AND id IN (${placeholders}) AND is_active = 1
  `).bind(tenantId, ...ids).all<Record<string, unknown>>();
  return new Map(results.map((item) => [Number(item.id), item]));
}

async function fetchServiceItem(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  serviceItemId: number,
) {
  return (await fetchServiceItems(db, tenantId, [serviceItemId])).get(serviceItemId);
}

async function fetchVisit(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  visitId: number,
) {
  const visit = await db.$client.prepare(
    `SELECT id, patient_id, doctor_id FROM visits WHERE id = ? AND tenant_id = ?`
  ).bind(visitId, tenantId).first<{ id: number; patient_id: number; doctor_id: number | null }>();
  return visit;
}

import { inferReceptionVisitServiceType } from '../../lib/service-type-inference';
export { inferReceptionVisitServiceType } from '../../lib/service-type-inference';

async function ensureTokenReservationsTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS token_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER,
      reservation_date TEXT NOT NULL,
      end_date TEXT NOT NULL DEFAULT '2099-12-31',
      token_from INTEGER NOT NULL,
      token_to INTEGER NOT NULL,
      label TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now', '+6 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
      UNIQUE(tenant_id, doctor_id, reservation_date, token_from, token_to)
    )
  `).run();
  // Backfill column for installations upgrading from migration 0290.
  await db.prepare(`
    UPDATE token_reservations
    SET end_date = reservation_date
    WHERE end_date IS NULL
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_token_reservations_lookup
      ON token_reservations(tenant_id, doctor_id, reservation_date, is_active)
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_token_reservations_date
      ON token_reservations(tenant_id, reservation_date)
  `).run();
  // Range lookup: ? between reservation_date and end_date.
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_token_reservations_range
      ON token_reservations(tenant_id, doctor_id, reservation_date, end_date, is_active)
  `).run();
}

// ═══════════════════════════════════════════════════════════════════
// 1. LIST AVAILABLE SERVICES (for reception dropdown/search)
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/services', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search') || '';
  const departmentId = c.req.query('department_id');
  const priceCategoryId = c.req.query('price_category_id');
  const isLabCatalog = c.req.query('is_lab_catalog');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);

  // Build cache key
  const cacheKey = `services:${tenantId}:${search}:${departmentId || ''}:${priceCategoryId || ''}:${isLabCatalog || ''}:${limit}`;
  
  // Try KV cache for non-search queries
  if (!search && c.env.KV) {
    const cached = await getCache(c.env.KV, cacheKey);
    if (cached) {
      c.header('X-Cache', 'HIT');
      return c.json({ services: cached });
    }
  }

  const params: (string | number)[] = [];
  let priceJoin = '';
  if (priceCategoryId) {
    priceJoin = `
      LEFT JOIN billing_item_price_category_maps pcm
        ON pcm.service_item_id = si.id
       AND pcm.tenant_id = si.tenant_id
       AND pcm.price_category_id = ?
       AND COALESCE(pcm.is_active, 1) = 1
    `;
    params.push(Number(priceCategoryId));
  }

  let where = `WHERE si.tenant_id = ? AND COALESCE(si.is_active, 1) = 1`;
  params.push(tenantId);
  where += ' AND (si.service_department_id IS NULL OR (sd.id IS NOT NULL AND COALESCE(sd.is_active, 1) = 1))';
  if (search) {
    where += ' AND (si.item_name LIKE ? OR si.item_code LIKE ? OR sd.department_name LIKE ? OR ltc.category LIKE ? OR rit.name LIKE ?)';
    const p = `%${search}%`;
    params.push(p, p, p, p, p);
  }
  if (isLabCatalog === '1') {
    where += ' AND ltc.id IS NOT NULL';
  } else if (isLabCatalog === '0') {
    where += ' AND ltc.id IS NULL';
  }
  if (departmentId) {
    where += ' AND si.service_department_id = ?';
    params.push(Number(departmentId));
  }
  params.push(limit);

  const serviceSql = `
    SELECT
      si.id,
      si.item_name,
      si.item_code,
      si.service_department_id,
      sd.department_name,
      COALESCE(ltc.category, rit.name, si.description) as category_name,
      COALESCE(uc.usage_count, 0) as usage_count,
      COALESCE(${priceCategoryId ? 'pcm.price' : 'NULL'}, si.price) as price,
      CASE WHEN ltc.id IS NOT NULL THEN 1 ELSE 0 END as is_lab_catalog,
      CASE WHEN rii.id IS NOT NULL THEN 1 ELSE 0 END as is_radiology
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id IN (si.tenant_id, '0')
    LEFT JOIN lab_test_catalog ltc
      ON ltc.billing_service_item_id = si.id
     AND ltc.tenant_id = si.tenant_id
     AND COALESCE(ltc.is_active, 1) = 1
    LEFT JOIN radiology_imaging_items rii
      ON rii.billing_service_item_id = si.id
     AND rii.tenant_id = si.tenant_id
     AND COALESCE(rii.is_active, 1) = 1
    LEFT JOIN radiology_imaging_types rit
      ON rit.id = rii.imaging_type_id
     AND rit.tenant_id = rii.tenant_id
     AND COALESCE(rit.is_active, 1) = 1
    LEFT JOIN billing_service_item_usage_stats uc
      ON uc.tenant_id = si.tenant_id
     AND uc.service_item_id = si.id
    ${priceJoin}
    ${where}
    ORDER BY usage_count DESC, sd.department_name, si.item_name
    LIMIT ?`;

  const { results } = await db.$client.prepare(serviceSql).bind(...params).all();

  // Cache in KV (fire-and-forget) for non-search queries
  if (!search && c.env.KV) {
    const cacheWrite = setCache(c.env.KV, cacheKey, results, 300); // 5 min TTL
    try {
      c.executionCtx.waitUntil(cacheWrite);
    } catch {
      void cacheWrite;
    }
  }

  c.header('X-Cache', 'MISS');
  return c.json({ services: results });
});

// ═══════════════════════════════════════════════════════════════════
// 2. LIST SERVICE DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/service-departments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    `SELECT id, department_name, department_code
     FROM billing_service_departments sd
     WHERE sd.tenant_id IN (?, '0')
       AND COALESCE(sd.is_active, 1) = 1
       AND EXISTS (
         SELECT 1
         FROM billing_service_items si
         WHERE si.tenant_id = ?
           AND si.service_department_id = sd.id
           AND COALESCE(si.is_active, 1) = 1
       )
     ORDER BY department_name`
  ).bind(tenantId, tenantId).all();
  return c.json({ departments: results });
});

// ═══════════════════════════════════════════════════════════════════
// 2A. GLOBAL PATIENT CONTEXT DRAWER
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/patients/:id/context', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('id'));
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient ID' });
  }

  const db = getDb(c.env.DB);
  const depositAdjustedExpression = `COALESCE((
    SELECT SUM(COALESCE(bd.amount, 0))
    FROM billing_deposits bd
    WHERE bd.tenant_id = b.tenant_id
      AND bd.reference_bill_id = b.id
      AND bd.transaction_type = 'adjustment'
      AND COALESCE(bd.is_active, 1) = 1
  ), 0)`;
  const settledAmountExpression = `(COALESCE(b.paid, 0) + ${depositAdjustedExpression})`;
  const calculatedOutstandingExpression = `MAX(0, COALESCE(b.total, 0) - ${settledAmountExpression})`;
  const outstandingExpression = `MIN(MAX(0, COALESCE(b.due, ${calculatedOutstandingExpression})), ${calculatedOutstandingExpression})`;

  // Batch required context queries, but keep secondary fail-open queries isolated.
  const batchResults = await db.$client.batch([
    db.$client.prepare(`
      SELECT id, patient_code, name, mobile, age, gender, date_of_birth, address
      FROM patients
      WHERE tenant_id = ? AND id = ?
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT v.id, v.visit_no, v.visit_type, v.visit_date, v.status, v.doctor_id,
             v.appointment_id AS canonical_observation_appointment_id,
             d.name AS doctor_name
      FROM visits v
      LEFT JOIN doctors d ON d.id = v.doctor_id AND d.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? AND v.patient_id = ?
      ORDER BY v.created_at DESC
      LIMIT 8
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT b.id, b.invoice_no, b.visit_id,
             COALESCE(b.total, 0) AS total_amount,
             COALESCE(b.paid, 0) AS cash_paid_amount,
             ${depositAdjustedExpression} AS deposit_adjusted,
             ${settledAmountExpression} AS settled_amount,
             ${settledAmountExpression} AS paid_amount,
             ${outstandingExpression} AS due,
             ${outstandingExpression} AS outstanding,
             b.status, b.created_at,
             COALESCE(b.test_bill, 0) AS test_bill,
             COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
             COALESCE(b.operation_bill, 0) AS operation_bill,
             COALESCE(b.admission_bill, 0) AS admission_bill,
             COALESCE(b.medicine_bill, 0) AS medicine_bill,
             v.appointment_id AS visit_appointment_id
      FROM bills b
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND b.patient_id = ?
        AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded')
        AND ${outstandingExpression} > 0
      ORDER BY b.created_at DESC
      LIMIT 50
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT b.id, b.invoice_no, b.visit_id,
             COALESCE(b.total, 0) AS total_amount,
             COALESCE(b.paid, 0) AS cash_paid_amount,
             ${depositAdjustedExpression} AS deposit_adjusted,
             ${settledAmountExpression} AS settled_amount,
             ${settledAmountExpression} AS paid_amount,
             ${outstandingExpression} AS due,
             ${outstandingExpression} AS outstanding,
             b.status, b.created_at,
             COALESCE(b.test_bill, 0) AS test_bill,
             COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
             COALESCE(b.operation_bill, 0) AS operation_bill,
             COALESCE(b.admission_bill, 0) AS admission_bill,
             COALESCE(b.medicine_bill, 0) AS medicine_bill,
             v.appointment_id AS visit_appointment_id
      FROM bills b
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND b.patient_id = ?
      ORDER BY b.created_at DESC
      LIMIT 10
    `).bind(tenantId, patientId),
    db.$client.prepare(`
      SELECT a.id, a.admission_no, a.status, a.admission_date, a.bed_id,
             a.doctor_id AS canonical_observation_doctor_id,
             b.ward_name, b.bed_number, d.name AS doctor_name
      FROM admissions a
      LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
      LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?
        AND a.patient_id = ?
        AND a.status IN ('admitted','critical','transferred')
        AND NOT EXISTS (
          SELECT 1
          FROM admissions newer_final
          WHERE newer_final.tenant_id = a.tenant_id
            AND newer_final.patient_id = a.patient_id
            AND newer_final.id != a.id
            AND newer_final.status IN ('discharged','closed','cancelled','transferred_out')
            AND (
              datetime(COALESCE(newer_final.admission_date, newer_final.discharge_date, newer_final.created_at)) >= datetime(COALESCE(a.admission_date, a.created_at))
              OR newer_final.id > a.id
            )
        )
      ORDER BY a.admission_date DESC
      LIMIT 1
    `).bind(tenantId, patientId),
  ]);

  const patient = batchResults[0]?.results?.[0] as Record<string, unknown> | undefined;
  const visits = { results: (batchResults[1]?.results ?? []) as Record<string, unknown>[] };
  const dueBills = { results: (batchResults[2]?.results ?? []) as Record<string, unknown>[] };
  const bills = { results: (batchResults[3]?.results ?? []) as Record<string, unknown>[] };
  const admission = batchResults[4]?.results?.[0] as Record<string, unknown> | undefined;

  // Replaced Promise.all() with c.env.DB.batch() for reception dashboard stats.
  // Why: Promise.all() sends 6 separate HTTP network requests to Cloudflare D1.
  let batchResults2: any[] = [];
  try {
    batchResults2 = await c.env.DB.batch([
      c.env.DB.prepare(`
        SELECT a.id, a.admission_no, a.status, a.admission_date, a.discharge_date,
               b.ward_name, b.bed_number, d.name AS doctor_name
        FROM admissions a
        LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
        LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status = 'discharged'
        ORDER BY a.admission_date DESC
        LIMIT 5
      `).bind(tenantId, patientId),
      c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
          COALESCE(SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END), 0) AS total_refunds,
          COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0) AS total_adjustments
        FROM billing_deposits
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      `).bind(tenantId, patientId),
      c.env.DB.prepare(`
        SELECT lo.id, lo.order_no, lo.status, lo.order_date,
               COUNT(loi.id) AS item_count,
               SUM(CASE WHEN COALESCE(loi.status, lo.status) IN ('completed','verified','delivered','reported') THEN 1 ELSE 0 END) AS ready_count
        FROM lab_orders lo
        LEFT JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
        WHERE lo.tenant_id = ? AND lo.patient_id = ?
        GROUP BY lo.id
        ORDER BY lo.order_date DESC
        LIMIT 8
      `).bind(tenantId, patientId),
      c.env.DB.prepare(`
        SELECT p.id, p.receipt_no, p.amount, p.payment_method, p.payment_type, p.date, p.created_at,
               b.invoice_no
        FROM payments p
        JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND b.patient_id = ?
        ORDER BY COALESCE(p.date, p.created_at) DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      c.env.DB.prepare(`
        SELECT id, deposit_receipt_no, amount, transaction_type, payment_method, reference_bill_id, remarks, created_at
        FROM billing_deposits
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      c.env.DB.prepare(`
        SELECT COALESCE(SUM(p.amount), 0) AS total_paid
        FROM payments p
        JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND b.patient_id = ?
      `).bind(tenantId, patientId),
    ]);
  } catch (error) {
    console.error('Batch query failed in reception dashboard', error);
  }

  const pastAdmissions = { results: batchResults2[0]?.results ?? [] };
  const deposits = batchResults2[1]?.results?.[0] as Record<string, number> ?? {
    total_deposits: 0,
    total_refunds: 0,
    total_adjustments: 0,
  };
  const labOrders = { results: batchResults2[2]?.results ?? [] };
  const payments = { results: batchResults2[3]?.results ?? [] };
  const depositLedger = { results: batchResults2[4]?.results ?? [] };
  const totalPaidResult = batchResults2[5]?.results?.[0] as Record<string, unknown> ?? { total_paid: 0 };

  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  function deriveBillType(bill: Record<string, unknown>): 'opd' | 'ipd' | 'pharmacy' {
    if (Number(bill.admission_bill ?? 0) > 0) return 'ipd';
    if (bill.visit_appointment_id != null) return 'opd';
    if (bill.visit_id != null) return 'opd';
    if (Number(bill.test_bill ?? 0) > 0 || Number(bill.medicine_bill ?? 0) > 0) return 'pharmacy';
    return 'opd';
  }

  type NormalizedBill = Record<string, unknown> & { paid_amount: number; due: number; bill_type: string };
  const normalizedBills: NormalizedBill[] = (bills.results ?? []).map((bill: Record<string, unknown>) => {
    const total = Number(bill.total_amount ?? 0);
    const depositAdjusted = Math.max(0, Number(bill.deposit_adjusted ?? 0));
    const settled = Math.max(0, Number(bill.settled_amount ?? bill.paid_amount ?? 0));
    const due = Math.min(Math.max(0, Number(bill.due ?? Math.max(0, total - settled))), Math.max(0, total - settled));
    return { ...bill, deposit_adjusted: depositAdjusted, paid_amount: settled, due, bill_type: deriveBillType(bill) };
  });
  const normalizedDueBills: NormalizedBill[] = (dueBills.results ?? []).map((bill: Record<string, unknown>) => {
    const total = Number(bill.total_amount ?? 0);
    const depositAdjusted = Math.max(0, Number(bill.deposit_adjusted ?? 0));
    const settled = Math.max(0, Number(bill.settled_amount ?? bill.paid_amount ?? 0));
    const due = Math.min(Math.max(0, Number(bill.due ?? Math.max(0, total - settled))), Math.max(0, total - settled));
    return { ...bill, deposit_adjusted: depositAdjusted, paid_amount: settled, due, bill_type: deriveBillType(bill) };
  });

  // Build visit-level bill mapping for OPD History tab
  const allBillsWithVisits = [...normalizedBills, ...normalizedDueBills.filter((db) => !normalizedBills.some((b) => b.id === db.id))];
  const visitBillsMap = new Map<number, typeof allBillsWithVisits>();
  for (const bill of allBillsWithVisits) {
    const vid = Number(bill.visit_id ?? 0);
    if (vid > 0) {
      const existing = visitBillsMap.get(vid) ?? [];
      if (!existing.some((b) => b.id === bill.id)) {
        existing.push(bill);
        visitBillsMap.set(vid, existing);
      }
    }
  }
  const visitBills = Array.from(visitBillsMap.entries()).map(([visit_id, bills]) => ({ visit_id, bills }));

  const rawDepositBalance = Number(deposits?.total_deposits ?? 0)
    - Number(deposits?.total_refunds ?? 0)
    - Number(deposits?.total_adjustments ?? 0);
  const depositBalance = Math.max(0, rawDepositBalance);

  let ipdPending: Record<string, number> | null = null;
  let ipdBillingSummary: Record<string, number> | null = null;
  if (admission?.id) {
    const snapshot = await loadIpdAdmissionBillingSnapshot(c.env.DB, tenantId, Number(admission.id));
    const provisionalTotal = Number(snapshot?.summary.provisional_total ?? 0);
    const bedTotal = Number(snapshot?.summary.bed_total ?? 0);
    const total = Number(snapshot?.summary.running_total ?? 0);
    ipdBillingSummary = snapshot?.summary ?? null;
    if (total > 0) {
      ipdPending = {
        admissionId: Number(admission.id),
        provisionalTotal,
        bedTotal,
        total,
        due: Number(snapshot?.summary.net_payable ?? Math.max(0, total - Math.max(0, depositBalance))),
      };
    }
  }

  // Billing timeline — combined charges + payments chronologically
  let timelineCharges: Record<string, unknown>[] = [];
  try {
    const timelineResult = await c.env.DB.prepare(`
      SELECT 'charge' AS type, item_name AS description, item_category AS category,
             total_amount AS amount, created_at, created_by, NULL AS payment_method, NULL AS receipt_no
      FROM billing_provisional_items
      WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      UNION ALL
      SELECT 'payment' AS type, 'Payment received' AS description, 'payment' AS category,
             p.amount, COALESCE(p.date, p.created_at) AS created_at, p.received_by AS created_by,
             p.payment_method, p.receipt_no
      FROM payments p
      JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND b.patient_id = ?
      UNION ALL
      SELECT CASE WHEN d.transaction_type = 'deposit' THEN 'deposit' ELSE d.transaction_type END AS type,
             COALESCE(d.remarks, d.transaction_type) AS description, 'deposit' AS category,
             d.amount, d.created_at, d.created_by, d.payment_method, d.deposit_receipt_no AS receipt_no
      FROM billing_deposits d
      WHERE d.tenant_id = ? AND d.patient_id = ? AND d.is_active = 1
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(tenantId, patientId, tenantId, patientId, tenantId, patientId).all<Record<string, unknown>>();
    timelineCharges = timelineResult.results ?? [];
  } catch {
    timelineCharges = [];
  }

  let refundRequests: ReturnType<typeof summarizeRefundApprovalRequests> = [];
  try {
    const refundRequestRows = await c.env.DB.prepare(`
      SELECT ar.id, ar.entity_id, ar.entity_no, ar.status, ar.execution_status, ar.request_data, ar.created_at
      FROM approval_requests ar
      JOIN bills b
        ON b.id = ar.entity_id
       AND b.tenant_id = ar.tenant_id
      WHERE ar.tenant_id = ?
        AND ar.type = 'refund'
        AND b.patient_id = ?
      ORDER BY ar.id DESC
      LIMIT 20
    `).bind(tenantId, patientId).all<Record<string, unknown>>();
    refundRequests = summarizeRefundApprovalRequests(refundRequestRows.results ?? []);
  } catch {
    refundRequests = [];
  }

  try {
    await observeReceptionPatientContextCriticalReads(c.env.DB as never, {
      tenantId,
      patientId,
      visits: (visits.results ?? []).map((row) => ({
        id: Number(row.id ?? 0),
        doctorId: row.doctor_id == null ? null : Number(row.doctor_id),
        appointmentId: row.canonical_observation_appointment_id == null
          ? null
          : Number(row.canonical_observation_appointment_id),
      })),
      activeAdmission: admission?.id == null
        ? null
        : {
          id: Number(admission.id),
          doctorId: admission.canonical_observation_doctor_id == null
            ? null
            : Number(admission.canonical_observation_doctor_id),
        },
      timezone: 'Asia/Dhaka',
      observedAtUtc: new Date().toISOString(),
      latencyBudgetMs: 250,
      buildSha: c.env.CF_VERSION_METADATA?.id ?? 'local-development',
    });
  } catch (error) {
    if (error instanceof CriticalReadShadowBatchError && error.code !== 'CANONICAL_MODE_BLOCKED') {
      console.error('Reception patient context Canonical shadow comparison failed closed:', error);
    } else if (error instanceof CriticalReadShadowBatchError) {
      throw new HTTPException(503, { message: 'Canonical patient context promotion is not authorized for this response contract' });
    } else {
      throw error;
    }
  }

  const visitsForResponse = (visits.results ?? []).map((row) => {
    const sanitized = { ...row };
    delete sanitized.canonical_observation_appointment_id;
    return sanitized;
  });
  const activeAdmissionForResponse = admission == null ? null : { ...admission };
  if (activeAdmissionForResponse) delete activeAdmissionForResponse.canonical_observation_doctor_id;

  return c.json({
    patient,
	    visits: visitsForResponse,
	    bills: normalizedBills,
    dueBills: normalizedDueBills,
    visitBills,
	    activeAdmission: activeAdmissionForResponse,
	    pastAdmissions: pastAdmissions.results ?? [],
    deposits: { ...(deposits ?? {}), balance: depositBalance, raw_balance: rawDepositBalance },
    payments: payments.results ?? [],
    depositLedger: depositLedger.results ?? [],
    reports: labOrders.results ?? [],
    billingTimeline: timelineCharges,
    refundRequests,
    ipdPending,
    ipdBillingSummary,
    totalPaid: Number(totalPaidResult?.total_paid ?? 0) + Number(deposits?.total_adjustments ?? 0),
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2B. REPORT DELIVERY LOOKUP
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/report-delivery/lookup', async (c) => {
  const tenantId = requireTenantId(c);
  const invoice = (c.req.query('invoice') || '').trim();
  if (!invoice) throw new HTTPException(400, { message: 'Invoice number is required' });

	  const bill = await c.env.DB.prepare(`
	    SELECT b.id, b.invoice_no, COALESCE(b.total, 0) AS total_amount,
           COALESCE(b.paid, 0) AS cash_paid_amount,
           COALESCE((
             SELECT SUM(bd.amount)
             FROM billing_deposits bd
             WHERE bd.tenant_id = b.tenant_id
               AND bd.reference_bill_id = b.id
               AND bd.transaction_type = 'adjustment'
               AND bd.is_active = 1
           ), 0) AS deposit_adjusted,
           (
             COALESCE(b.paid, 0) + COALESCE((
               SELECT SUM(bd.amount)
               FROM billing_deposits bd
               WHERE bd.tenant_id = b.tenant_id
                 AND bd.reference_bill_id = b.id
                 AND bd.transaction_type = 'adjustment'
                 AND bd.is_active = 1
             ), 0)
           ) AS paid_amount,
           b.due, b.status, b.created_at,
           p.id AS patient_id, p.name AS patient_name, p.patient_code, p.mobile
    FROM bills b
    JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? AND (b.invoice_no = ? OR b.id = ?)
    LIMIT 1
  `).bind(tenantId, invoice, Number(invoice) || -1).first<Record<string, unknown>>();

  if (!bill) throw new HTTPException(404, { message: 'Invoice not found' });

  const labItems = await c.env.DB.prepare(`
    SELECT loi.id, lo.id as lab_order_id, COALESCE(ltc.name, 'Lab test') AS test_name, loi.status, lo.order_no
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
    WHERE loi.tenant_id = ? AND lo.bill_id = ?
    ORDER BY loi.id ASC
  `).bind(tenantId, bill.id).all().catch(() => ({ results: [] }));

  const labOrders = await c.env.DB.prepare(`
    SELECT
      lo.id as lab_order_id,
      lo.order_no,
      lo.status,
      COUNT(loi.id) as item_count,
      SUM(CASE WHEN LOWER(COALESCE(loi.status, lo.status, 'pending')) IN ('completed', 'verified', 'delivered', 'reported', 'ready') THEN 1 ELSE 0 END) as ready_count,
      SUM(CASE WHEN LOWER(COALESCE(loi.status, lo.status, 'pending')) = 'delivered' THEN 1 ELSE 0 END) as delivered_count
    FROM lab_orders lo
    LEFT JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
    WHERE lo.tenant_id = ? AND lo.bill_id = ?
    GROUP BY lo.id
    ORDER BY lo.id ASC
  `).bind(tenantId, bill.id).all().catch(() => ({ results: [] }));

  const total = Number(bill.total_amount ?? 0);
  const paid = Number(bill.paid_amount ?? bill.paid ?? 0);
  const due = Math.min(
    Math.max(0, Number(bill.due ?? total - paid)),
    Math.max(0, total - paid),
  );
  const reports = labItems.results ?? [];
  const readyStatuses = new Set(['completed', 'verified', 'delivered', 'reported', 'ready']);
  const allReady = reports.length === 0 || reports.every((item: Record<string, unknown>) => readyStatuses.has(String(item.status ?? '').toLowerCase()));
  const orders = (labOrders.results ?? []).map((order: Record<string, unknown>) => {
    const itemCount = Number(order.item_count ?? 0);
    const readyCount = Number(order.ready_count ?? 0);
    return {
      labOrderId: Number(order.lab_order_id),
      orderNo: order.order_no,
      status: order.status,
      itemCount,
      readyCount,
      deliveredCount: Number(order.delivered_count ?? 0),
      canPrint: itemCount > 0 && readyCount >= itemCount && due <= 0,
    };
  });

  return c.json({
    invoice: {
      id: bill.id,
      invoiceNo: bill.invoice_no,
      status: bill.status,
      totalAmount: total,
      paidAmount: paid,
      dueAmount: due,
      depositAdjusted: Number(bill.deposit_adjusted ?? 0),
      createdAt: bill.created_at,
    },
    patient: {
      id: bill.patient_id,
      name: bill.patient_name,
      patientCode: bill.patient_code,
      mobile: bill.mobile,
    },
    reports,
    orders,
    canPrint: due <= 0 && allReady,
    needsPayment: due > 0,
    allReady,
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2C. TODAY DOCTOR STATUS
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/doctors/today', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const statusType = c.req.query('status_type');
  await ensureDoctorDailyStatusTable(c.env.DB);

  let statusFilter = '';
  const params: (string | number)[] = [date, date, tenantId];
  if (statusType) {
    statusFilter = ' AND COALESCE(ds.status_type, \'available\') = ?';
    params.push(statusType);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT d.id, d.name, d.specialty, d.department, d.consultation_fee,
           COALESCE(ds.is_available, 1) AS is_available,
           COALESCE(ds.status_type, 'available') AS status_type,
           COALESCE(ds.reason, '') AS reason,
           ds.max_serial,
           COUNT(a.id) AS serial_count
    FROM doctors d
    LEFT JOIN doctor_daily_status ds
      ON ds.doctor_id = d.id AND ds.tenant_id = d.tenant_id AND ds.status_date = ?
    LEFT JOIN appointments a
      ON a.doctor_id = d.id AND a.tenant_id = d.tenant_id AND a.appt_date = ?
      AND a.status NOT IN ('cancelled','no_show')
    WHERE d.tenant_id = ? AND d.is_active = 1 ${statusFilter}
    GROUP BY d.id
    ORDER BY d.display_order ASC, d.name ASC
  `).bind(...params).all();

  return c.json({ date, doctors: results });
});

receptionRoutes.patch('/doctors/:doctorId/today', zValidator('json', doctorTodayStatusSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = Number(c.req.param('doctorId'));
  const date = c.req.query('date') || getTodayGMT6();
  const data = c.req.valid('json');
  if (!Number.isInteger(doctorId) || doctorId <= 0) throw new HTTPException(400, { message: 'Invalid doctor ID' });
  await ensureDoctorDailyStatusTable(c.env.DB);

  const doctor = await c.env.DB.prepare('SELECT id FROM doctors WHERE tenant_id = ? AND id = ? AND is_active = 1')
    .bind(tenantId, doctorId).first<{ id: number }>();
  if (!doctor) throw new HTTPException(404, { message: 'Doctor not found' });

  const existing = await c.env.DB.prepare(`
    SELECT is_available, status_type, reason, max_serial, start_time, end_time FROM doctor_daily_status
    WHERE tenant_id = ? AND doctor_id = ? AND status_date = ?
  `).bind(tenantId, doctorId, date).first<DoctorDailyStatusRow>();

  if (hasDoctorTimelineConflict(existing, data)) {
    throw new HTTPException(409, {
      message: 'This doctor already has a doctor-managed timed schedule for the selected date. Change it from Doctor Timeline instead of Reception status.',
    });
  }

  // Determine final values based on provided data
  const isAvailable = data.isAvailable === undefined ? Number(existing?.is_available ?? 1) : (data.isAvailable ? 1 : 0);
  const statusType = data.statusType ?? existing?.status_type ?? 'available';
  const reason = data.reason !== undefined ? data.reason : (existing?.reason ?? null);
  const maxSerial = data.maxSerial === undefined ? (existing?.max_serial ?? null) : data.maxSerial;

  // If status_type is not_coming or on_leave, force is_available to 0
  const finalIsAvailable = ['not_coming', 'on_leave', 'emergency_leave'].includes(statusType) ? 0 : isAvailable;

  await c.env.DB.prepare(`
    INSERT INTO doctor_daily_status (tenant_id, doctor_id, status_date, is_available, status_type, reason, max_serial, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, doctor_id, status_date)
    DO UPDATE SET is_available = excluded.is_available,
                  status_type = excluded.status_type,
                  reason = excluded.reason,
                  max_serial = excluded.max_serial,
                  updated_by = excluded.updated_by,
                  updated_at = datetime('now', '+6 hours')
  `).bind(tenantId, doctorId, date, finalIsAvailable, statusType, reason, maxSerial, userId).run();

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'doctor_daily_status', doctorId, existing ?? null, {
    doctorId,
    date,
    isAvailable: Boolean(finalIsAvailable),
    statusType,
    reason,
    maxSerial,
  });

  return c.json({ doctorId, date, isAvailable: Boolean(finalIsAvailable), statusType, reason, maxSerial });
});

// ═══════════════════════════════════════════════════════════════════
// 2E. BULK UPDATE DOCTOR STATUS
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.post('/doctors/bulk-status', zValidator('json', doctorBulkStatusSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const data = c.req.valid('json');
  await ensureDoctorDailyStatusTable(c.env.DB);

  const results: Array<{ doctorId: number; success: boolean; isAvailable: boolean; statusType: string; error?: string }> = [];

  for (const update of data.updates) {
    try {
      const doctor = await c.env.DB.prepare('SELECT id FROM doctors WHERE tenant_id = ? AND id = ? AND is_active = 1')
        .bind(tenantId, update.doctorId).first<{ id: number }>();
      if (!doctor) {
        results.push({ doctorId: update.doctorId, success: false, isAvailable: false, statusType: 'available', error: 'Doctor not found' });
        continue;
      }

      const existing = await c.env.DB.prepare(`
        SELECT is_available, status_type, reason, max_serial, start_time, end_time FROM doctor_daily_status
        WHERE tenant_id = ? AND doctor_id = ? AND status_date = ?
      `).bind(tenantId, update.doctorId, date).first<DoctorDailyStatusRow>();

      if (hasDoctorTimelineConflict(existing, update)) {
        results.push({
          doctorId: update.doctorId,
          success: false,
          isAvailable: Boolean(existing?.is_available ?? 1),
          statusType: existing?.status_type ?? 'available',
          error: 'Doctor has a doctor-managed timed schedule on this date. Edit it from Doctor Timeline.',
        });
        continue;
      }

      const isAvailable = update.isAvailable === undefined ? Number(existing?.is_available ?? 1) : (update.isAvailable ? 1 : 0);
      const statusType = update.statusType ?? existing?.status_type ?? 'available';
      const reason = update.reason !== undefined ? update.reason : (existing?.reason ?? null);
      const maxSerial = update.maxSerial === undefined ? (existing?.max_serial ?? null) : update.maxSerial;

      const finalIsAvailable = ['not_coming', 'on_leave', 'emergency_leave'].includes(statusType) ? 0 : isAvailable;

      await c.env.DB.prepare(`
        INSERT INTO doctor_daily_status (tenant_id, doctor_id, status_date, is_available, status_type, reason, max_serial, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, doctor_id, status_date)
        DO UPDATE SET is_available = excluded.is_available,
                      status_type = excluded.status_type,
                      reason = excluded.reason,
                      max_serial = excluded.max_serial,
                      updated_by = excluded.updated_by,
                      updated_at = datetime('now', '+6 hours')
      `).bind(tenantId, update.doctorId, date, finalIsAvailable, statusType, reason, maxSerial, userId).run();

      results.push({ doctorId: update.doctorId, success: true, isAvailable: Boolean(finalIsAvailable), statusType });
    } catch (error) {
      results.push({
        doctorId: update.doctorId,
        success: false,
        isAvailable: false,
        statusType: 'available',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'doctor_daily_status', 0, null, {
    action: 'bulk_update',
    date,
    updates: data.updates.length,
  });

  return c.json({ date, results });
});

// ═══════════════════════════════════════════════════════════════════
// 2D. QUICK ADMIT / TEMPORARY PATIENT CONTEXT
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.post('/quick-admit', zValidator('json', quickAdmitSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const mutationType = 'reception_quick_admit';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different quick-admit request',
      conflictMessage: 'Quick-admit request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);

    const reservedReplay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different quick-admit request',
      conflictMessage: 'Quick-admit request is already being processed. Please retry shortly.',
    });
    if (reservedReplay) return c.json({ ...reservedReplay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  try {
    const today = getTodayGMT6();
    const patientCode = await getNextSequence(c.env.DB, tenantId, 'unknown_patient', 'UKN');
    const patientName = data.name?.trim() || `Unknown Emergency ${patientCode}`;
    const visitNo = await getNextSequence(c.env.DB, tenantId, 'visit', 'V');

    const patientPayload = buildLocalSyncPatientPayload({
      tenantId,
      name: patientName,
      fatherHusband: '',
      address: '',
      mobile: data.mobile?.trim() || null,
      patientCode,
      gender: data.gender ?? 'other',
      age: data.age ?? null,
    });
    const quickAdmitStatements: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        INSERT INTO patients (tenant_id, patient_code, name, father_husband, address, mobile, age, gender, created_at)
        VALUES (?, ?, ?, '', '', ?, ?, ?, datetime('now', '+6 hours'))
      `).bind(tenantId, patientCode, patientName, data.mobile?.trim() || '', data.age ?? null, data.gender ?? 'other'),
    ];
    const patientOutboxStatement = await buildLocalSyncPatientCreateOutboxStatement(c.env, {
      tenantId,
      patientCode,
      payload: patientPayload,
    });
    if (patientOutboxStatement) quickAdmitStatements.push(patientOutboxStatement);
    quickAdmitStatements.push(
      c.env.DB.prepare(`
        INSERT INTO visits (tenant_id, patient_id, visit_no, visit_type, visit_date, status, created_by, created_at)
        SELECT ?, p.id, ?, 'emergency', ?, 'checked_in', ?, datetime('now', '+6 hours')
        FROM patients p
        WHERE p.tenant_id = ? AND p.patient_code = ?
      `).bind(tenantId, visitNo, today, userId, tenantId, patientCode),
    );
    await c.env.DB.batch(quickAdmitStatements);

    const patient = await c.env.DB.prepare(`
      SELECT id, patient_code, name, mobile, age, gender
      FROM patients
      WHERE tenant_id = ? AND patient_code = ?
    `).bind(tenantId, patientCode).first<Record<string, unknown>>();

    const responseBody = { patient, visitNo, message: 'Temporary emergency patient created' };
    if (data.idempotencyKey && idempotencyReserved) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
        sourceId: patient?.id != null ? Number(patient.id) : patientCode,
        responseBody,
      });
    }

    void createAuditLog(c.env, tenantId, userId, 'CREATE', 'patients', Number(patient?.id ?? 0), null, {
      source: 'reception_quick_admit',
      patientCode,
      reason: data.reason ?? null,
    }).catch((error) => console.error('Failed to audit reception quick admit:', error));

    return c.json(responseBody, 201);
  } catch (error) {
    if (data.idempotencyKey && idempotencyReserved) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => console.error('Failed to mark quick-admit idempotency key failed:', markError));
    }
    throw error;
  }
});

// ═══════════════════════════════════════════════════════════════════
// 2E. ADMISSION + OPTIONAL DEPOSIT ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/admission-candidates', async (c) => {
  const tenantId = requireTenantId(c);
  const search = String(c.req.query('search') ?? '').trim();
  const requestedLimit = Number.parseInt(String(c.req.query('limit') ?? '8'), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(20, Math.max(1, requestedLimit)) : 8;

  if (search.length < 2) return c.json({ patients: [] });

  const nameOrCode = `%${search.toLowerCase()}%`;
  const mobile = `%${search}%`;
  const result = await c.env.DB.prepare(`
    SELECT p.id, p.name, p.patient_code, p.mobile, p.date_of_birth, p.age, p.gender
    FROM patients p
    WHERE p.tenant_id = ?
      AND (
        lower(COALESCE(p.name, '')) LIKE ?
        OR lower(COALESCE(p.patient_code, '')) LIKE ?
        OR COALESCE(p.mobile, '') LIKE ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM admissions active
        WHERE active.tenant_id = p.tenant_id
          AND active.patient_id = p.id
          AND active.status IN ('admitted','critical','transferred')
      )
    ORDER BY p.name ASC, p.id ASC
    LIMIT ?
  `).bind(tenantId, nameOrCode, nameOrCode, mobile, limit).all<Record<string, unknown>>();

  return c.json({ patients: result.results ?? [] });
});

receptionRoutes.post('/admit-with-deposit', zValidator('json', admitWithDepositSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Reception admission');

  const mutationType = 'reception_admit_with_deposit';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;
  let idempotencyReserved = false;
  let coreCommitted = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different admission request',
      conflictMessage: 'Admission request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);

    const reservedReplay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different admission request',
      conflictMessage: 'Admission request is already being processed. Please retry shortly.',
    });
    if (reservedReplay) return c.json({ ...reservedReplay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  try {
    const activeAdmission = await c.env.DB.prepare(`
      SELECT admission_no FROM admissions
      WHERE tenant_id = ? AND patient_id = ? AND status IN ('admitted','critical','transferred')
      ORDER BY admission_date DESC LIMIT 1
    `).bind(tenantId, data.patientId).first<{ admission_no: string }>();
    if (activeAdmission) {
      throw new HTTPException(409, { message: `Patient is already admitted (${activeAdmission.admission_no})` });
    }

    if (data.bedId) {
      const bed = await c.env.DB.prepare('SELECT status FROM beds WHERE tenant_id = ? AND id = ?')
        .bind(tenantId, data.bedId).first<{ status: string }>();
      if (!bed) throw new HTTPException(404, { message: 'Bed not found' });
      if (bed.status !== 'available') throw new HTTPException(409, { message: `Bed is ${bed.status}` });
    }

    const admissionNo = await getNextSequence(c.env.DB, tenantId, 'admission', 'ADM');
    const admissionDate = new Date(Date.now() + 6 * 3600_000).toISOString().replace('T', ' ').substring(0, 19);
    const receiptNo = data.depositAmount > 0
      ? await getNextSequence(c.env.DB, tenantId, 'deposit', 'DEP')
      : null;
    const activeCounter = data.depositAmount > 0
      ? await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
        workstationId: getBillingWorkstationId(c),
        requireCurrentWorkstation: true,
      })
      : null;

    if (data.depositAmount > 0 && !activeCounter) {
      throw new HTTPException(409, { message: 'Activate a billing counter before collecting admission deposit.' });
    }

    const depositCollectedAtUtc = data.depositAmount > 0 ? new Date().toISOString() : null;
    const financialOperationKey = data.depositAmount > 0 && receiptNo
      ? `reception-admission-deposit:${admissionNo}:${receiptNo}`
      : null;
    if (data.depositAmount > 0) {
      await assertStrictFinancialBoundaryDisabledOrSupported(
        c.env.DB,
        String(tenantId),
        'reception.admission.deposit.collect',
      );
    }

    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        INSERT INTO admissions (
          tenant_id, admission_no, patient_id, bed_id, doctor_id, admission_type,
          admit_source, referral_doctor, admission_reason, is_emergency,
          provisional_diagnosis, notes, care_of_name, care_of_phone, care_of_relation,
          admission_fee, billing_mode, package_id, admission_date
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM admissions active
          WHERE active.tenant_id = ?
            AND active.patient_id = ?
            AND active.status IN ('admitted','critical','transferred')
        )
        AND (
          ? IS NULL
          OR EXISTS (
            SELECT 1 FROM beds b
            WHERE b.tenant_id = ?
              AND b.id = ?
              AND b.status = 'available'
          )
        )
      `).bind(
        tenantId,
        admissionNo,
        data.patientId,
        data.bedId ?? null,
        data.doctorId ?? null,
        data.admissionType,
        data.admitSource ?? (data.admissionType === 'emergency' ? 'emergency' : 'planned'),
        data.referralDoctor ?? null,
        data.admissionReason ?? null,
        data.admissionType === 'emergency' ? 1 : 0,
        data.provisionalDiagnosis ?? null,
        data.notes ?? null,
        data.careOfName ?? null,
        data.careOfPhone ?? null,
        data.careOfRelation ?? null,
        data.admissionFee ?? 0,
        data.billingMode ?? 'regular',
        data.packageId ?? null,
        admissionDate,
        tenantId,
        data.patientId,
        data.bedId ?? null,
        tenantId,
        data.bedId ?? null,
      ),
    ];

    if (financialOperationKey) {
      statements.push(prepareFinancialBatchAssertion(c.env.DB, {
        tenantId: String(tenantId),
        operationKey: financialOperationKey,
        stepKey: 'admission_insert',
        expectedChanges: 1,
      }));
    }

    if (data.bedId) {
      statements.push(c.env.DB.prepare(`
        UPDATE beds SET status = 'occupied'
        WHERE tenant_id = ? AND id = ? AND status = 'available'
          AND EXISTS (
            SELECT 1 FROM admissions a
            WHERE a.tenant_id = ?
              AND a.admission_no = ?
              AND a.bed_id = beds.id
          )
      `).bind(tenantId, data.bedId, tenantId, admissionNo));
      if (financialOperationKey) {
        statements.push(prepareFinancialBatchAssertion(c.env.DB, {
          tenantId: String(tenantId),
          operationKey: financialOperationKey,
          stepKey: 'bed_update',
          expectedChanges: 1,
        }));
      }

      statements.push(c.env.DB.prepare(`
        INSERT INTO patient_bed_infos (
          tenant_id, patient_id, admission_id, bed_id, ward_name, bed_number,
          bed_type, rate_per_day, started_on
        )
        SELECT ?, ?, a.id, b.id, b.ward_name, b.bed_number, b.bed_type,
               b.rate_per_day, datetime('now', '+6 hours')
        FROM admissions a
        JOIN beds b ON b.id = ? AND b.tenant_id = ?
        WHERE a.tenant_id = ? AND a.admission_no = ?
      `).bind(tenantId, data.patientId, data.bedId, tenantId, tenantId, admissionNo));
      if (financialOperationKey) {
        statements.push(prepareFinancialBatchAssertion(c.env.DB, {
          tenantId: String(tenantId),
          operationKey: financialOperationKey,
          stepKey: 'bed_history_insert',
          expectedChanges: 1,
        }));
      }
    }

    if (data.depositAmount > 0 && receiptNo && activeCounter) {
      const depositIdLookup = '(SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? LIMIT 1)';
      const sourceEventKey = createPostingEventKey(
        'patient_deposit',
        receiptNo,
        ACCOUNTING_EVENT_TYPES.patientDepositReceived,
      );
      const accountingPayload = {
        depositId: null,
        receiptNo,
        patientId: data.patientId,
        admissionNo,
        amount: data.depositAmount,
        paymentMethod: data.paymentMethod,
        counterId: activeCounter.counter_id,
        counterSessionId: activeCounter.id,
      };

      statements.push(c.env.DB.prepare(`
        INSERT INTO billing_deposits (
          tenant_id, patient_id, admission_id, deposit_receipt_no, amount,
          transaction_type, payment_method, remarks, created_by, counter_id,
          counter_session_id
        )
        SELECT ?, ?, a.id, ?, ?, 'deposit', ?, ?, ?, ?, ?
        FROM admissions a
        WHERE a.tenant_id = ? AND a.admission_no = ? AND a.patient_id = ?
      `).bind(
        tenantId,
        data.patientId,
        receiptNo,
        data.depositAmount,
        data.paymentMethod,
        `Admission deposit for ${admissionNo}`,
        userId,
        activeCounter.counter_id,
        activeCounter.id,
        tenantId,
        admissionNo,
        data.patientId,
      ));
      if (financialOperationKey) {
        statements.push(prepareFinancialBatchAssertion(c.env.DB, {
          tenantId: String(tenantId),
          operationKey: financialOperationKey,
          stepKey: 'deposit_insert',
          expectedChanges: 1,
        }));
      }

      statements.push(c.env.DB.prepare(`
        INSERT INTO emp_cash_transactions (
          tenant_id, employee_id, counter_id, counter_session_id, transaction_type,
          amount, reference_id, reference_type, payment_method, description
        )
        SELECT ?, ?, ?, ?, 'CashSales', ?, ${depositIdLookup}, 'deposit', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM billing_deposits bd
          WHERE bd.tenant_id = ? AND bd.deposit_receipt_no = ?
        )
      `).bind(
        tenantId,
        userId,
        activeCounter.counter_id,
        activeCounter.id,
        data.depositAmount,
        tenantId,
        receiptNo,
        data.paymentMethod,
        `Admission deposit ${receiptNo}`,
        tenantId,
        receiptNo,
      ));
      if (financialOperationKey) {
        statements.push(prepareFinancialBatchAssertion(c.env.DB, {
          tenantId: String(tenantId),
          operationKey: financialOperationKey,
          stepKey: 'cash_transaction_insert',
          expectedChanges: 1,
        }));
      }

      statements.push(c.env.DB.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events (
          tenant_id, source_event_key, source_type, source_id, event_type,
          event_date, payload_json, created_by
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM billing_deposits bd
          WHERE bd.tenant_id = ? AND bd.deposit_receipt_no = ?
        )
      `).bind(
        tenantId,
        sourceEventKey,
        'patient_deposit',
        receiptNo,
        ACCOUNTING_EVENT_TYPES.patientDepositReceived,
        today,
        JSON.stringify(accountingPayload),
        String(userId),
        tenantId,
        receiptNo,
      ));
      if (financialOperationKey) {
        statements.push(prepareFinancialBatchAssertion(c.env.DB, {
          tenantId: String(tenantId),
          operationKey: financialOperationKey,
          stepKey: 'accounting_event_insert',
          expectedChanges: 1,
        }));
      }
    }

    if (data.admissionFee && data.admissionFee > 0) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO billing_provisional_items (
          tenant_id, patient_id, admission_id, item_category, item_name, department,
          unit_price, quantity, discount_percent, discount_amount, total_amount,
          bill_status, is_active, created_by, created_at
        )
        SELECT ?, ?, a.id, 'admission', 'Admission Fee', 'Reception', ?, 1, 0, 0,
               ?, 'provisional', 1, ?, datetime('now', '+6 hours')
        FROM admissions a
        WHERE a.tenant_id = ? AND a.admission_no = ? AND a.patient_id = ?
      `).bind(
        tenantId,
        data.patientId,
        data.admissionFee,
        data.admissionFee,
        userId,
        tenantId,
        admissionNo,
        data.patientId,
      ));
      if (financialOperationKey) {
        statements.push(prepareFinancialBatchAssertion(c.env.DB, {
          tenantId: String(tenantId),
          operationKey: financialOperationKey,
          stepKey: 'admission_fee_insert',
          expectedChanges: 1,
        }));
      }
    }

    if (financialOperationKey) {
      statements.push(prepareClearFinancialBatchAssertions(
        c.env.DB,
        String(tenantId),
        financialOperationKey,
      ));
    }

    if (data.depositAmount > 0) {
      if (!receiptNo || !activeCounter || !depositCollectedAtUtc || !financialOperationKey) {
        throw new Error('Admission deposit financial authority was not prepared');
      }
      await executeStrictFinancialMutation({
        db: c.env.DB,
        tenantId: String(tenantId),
        boundary: 'reception.admission.deposit.collect',
        legacyStatements: statements,
        canonical: async (options) => {
          const tenderType = canonicalAdmissionDepositTenderType(data.paymentMethod);
          const canonicalInput = await buildLiveDepositProjection({
            tenantId: String(tenantId),
            depositNo: receiptNo,
            patientId: data.patientId,
            amount: data.depositAmount,
            tenderType,
            methodCode: String(data.paymentMethod || tenderType),
            collectedAtUtc: depositCollectedAtUtc,
          });
          return recordDeposit(c.env.DB, canonicalInput, options);
        },
      });
    } else {
      await c.env.DB.batch(statements);
    }
    coreCommitted = true;

    const admission = await c.env.DB.prepare(`
      SELECT a.id, a.admission_no, a.admission_date, p.name AS patient_name,
             p.patient_code, p.mobile, b.ward_name, b.bed_number
      FROM admissions a
      JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.admission_no = ?
    `).bind(tenantId, admissionNo).first<Record<string, unknown>>();

    if (!admission?.id) {
      const duplicateAdmission = await c.env.DB.prepare(`
        SELECT admission_no FROM admissions
        WHERE tenant_id = ? AND patient_id = ? AND status IN ('admitted','critical','transferred')
        ORDER BY admission_date DESC LIMIT 1
      `).bind(tenantId, data.patientId).first<{ admission_no: string }>();
      if (duplicateAdmission) {
        throw new HTTPException(409, { message: `Patient is already admitted (${duplicateAdmission.admission_no})` });
      }
      if (data.bedId) {
        const latestBed = await c.env.DB.prepare('SELECT status FROM beds WHERE tenant_id = ? AND id = ?')
          .bind(tenantId, data.bedId).first<{ status: string }>();
        if (!latestBed) throw new HTTPException(404, { message: 'Bed not found' });
        throw new HTTPException(409, { message: `Bed is ${latestBed.status || 'not available'}` });
      }
      throw new HTTPException(409, {
        message: 'Admission could not be created because patient status changed. Please refresh and try again.',
      });
    }

    await ensureLiveAdmissionContinuity(c.env.DB, {
      tenantId: String(tenantId),
      legacyAdmissionId: Number(admission.id),
      admissionNo,
      legacyPatientId: data.patientId,
      admissionType: data.admissionType,
      startedAtUtc: normalizeLegacyAdmissionStartedAtUtc(admissionDate),
    });

    let createdDeposit: { id: number; created_at?: string | null } | null = null;
    if (data.depositAmount > 0 && receiptNo) {
      createdDeposit = await c.env.DB.prepare(`
        SELECT id, created_at
        FROM billing_deposits
        WHERE tenant_id = ? AND deposit_receipt_no = ?
        LIMIT 1
      `).bind(tenantId, receiptNo).first<{ id: number; created_at?: string | null }>();
      if (!createdDeposit?.id) {
        throw new HTTPException(500, { message: 'Admission deposit ledger entry was not created' });
      }
    }

    const responseBody = {
      admission,
      admissionFee: data.admissionFee ?? 0,
      deposit: receiptNo
        ? { receiptNo, amount: data.depositAmount, paymentMethod: data.paymentMethod }
        : null,
    };

    if (data.idempotencyKey && idempotencyReserved) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
        sourceId: Number(admission.id) || admissionNo,
        responseBody,
      }).catch((error) => {
        console.error('Failed to complete admission idempotency key:', error);
      });
    }

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'admissions',
      Number(admission.id),
      null,
      {
        admissionNo,
        patientId: data.patientId,
        bedId: data.bedId ?? null,
        admissionFee: data.admissionFee ?? 0,
        depositReceiptNo: receiptNo,
        depositAmount: data.depositAmount,
      },
    ).catch((error) => {
      console.error('Failed to audit admission with deposit:', error);
    });

    if (createdDeposit?.id && receiptNo && activeCounter && depositCollectedAtUtc) {
      await shadowCreateCashLedgerEntry(c.env.DB, {
        tenantId,
        sourceType: 'patient_deposit',
        sourceId: Number(createdDeposit.id),
        sourceNo: receiptNo,
        eventType: 'PATIENT_DEPOSIT_RECEIVED',
        movementDirection: 'in',
        cashStatus: 'IN_DRAWER',
        status: 'posted',
        amount: data.depositAmount,
        expectedAmount: data.depositAmount,
        receivedAmount: data.depositAmount,
        dueAmount: 0,
        paymentMethod: data.paymentMethod || 'cash',
        fromUserId: data.patientId,
        toUserId: Number(userId),
        counterSessionId: activeCounter.id,
        counterId: activeCounter.counter_id,
        currentLocationType: 'drawer',
        currentLocationLabel: `Counter session #${activeCounter.id}`,
        referenceType: 'deposit',
        referenceId: Number(createdDeposit.id),
        note: `Admission deposit for ${admissionNo}`,
        metadata: {
          receiptNo,
          patientId: data.patientId,
          admissionId: Number(admission.id),
          admissionNo,
          shadowSource: 'billing_deposits',
        },
        idempotencyKey: `cash-ledger:deposit:${createdDeposit.id}:received`,
        createdBy: Number(userId),
        occurredAt: depositCollectedAtUtc,
      }).catch((error) => {
        console.error('Failed to write admission deposit cash-ledger shadow:', error);
      });
    }

    if (receiptNo) queueReceptionAccountingPosting(c, tenantId);
    return c.json(responseBody, 201);
  } catch (error) {
    let mappedError: unknown = error;
    if (isFinancialBatchAssertionError(error)) {
      try {
        const duplicateAdmission = await c.env.DB.prepare(`
          SELECT admission_no FROM admissions
          WHERE tenant_id = ? AND patient_id = ? AND status IN ('admitted','critical','transferred')
          ORDER BY admission_date DESC LIMIT 1
        `).bind(tenantId, data.patientId).first<{ admission_no: string }>();
        if (duplicateAdmission) {
          mappedError = new HTTPException(409, {
            message: `Patient is already admitted (${duplicateAdmission.admission_no})`,
          });
        } else if (data.bedId) {
          const latestBed = await c.env.DB.prepare('SELECT status FROM beds WHERE tenant_id = ? AND id = ?')
            .bind(tenantId, data.bedId).first<{ status: string }>();
          if (!latestBed) {
            mappedError = new HTTPException(404, { message: 'Bed not found' });
          } else if (latestBed.status !== 'available') {
            mappedError = new HTTPException(409, { message: `Bed is ${latestBed.status}` });
          } else {
            mappedError = new HTTPException(409, {
              message: 'Admission or deposit state changed. Refresh and try again.',
            });
          }
        } else {
          mappedError = new HTTPException(409, {
            message: 'Admission or deposit state changed. Refresh and try again.',
          });
        }
      } catch (resolutionError) {
        console.error('Failed to resolve admission deposit assertion error:', resolutionError);
        mappedError = new HTTPException(409, {
          message: 'Admission or deposit state changed. Refresh and try again.',
        });
      }
    }

    if (!coreCommitted && data.idempotencyKey && idempotencyReserved) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark admission idempotency key failed:', markError);
      });
    }
    throw mappedError;
  }
});

// ═══════════════════════════════════════════════════════════════════
// 3. ADD A SERVICE TO A VISIT
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.post('/visits/:visitId/services', zValidator('json', addServiceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const visitId = Number(c.req.param('visitId'));
  const data = c.req.valid('json');
  assertReceptionDiscountAllowed(c, data.discountAmount);

  const idempotency = await beginReceptionMutationIdempotency({
    db: c.env.DB,
    tenantId,
    userId,
    mutationType: 'reception_visit_service_add',
    idempotencyKey: data.idempotencyKey,
    payload: { visitId, ...data, idempotencyKey: undefined },
    mismatchMessage: 'Idempotency key was already used for a different visit service request',
    conflictMessage: 'Visit service request is already being processed. Please retry shortly.',
  });
  if (idempotency.replay) return c.json({ ...idempotency.replay, idempotent: true }, 201);

  try {
    const visit = await fetchVisit(db, tenantId, visitId);
    if (!visit) throw new HTTPException(404, { message: 'Visit not found' });

    const serviceItem = await fetchServiceItem(db, tenantId, data.serviceItemId);
    if (!serviceItem) throw new HTTPException(404, { message: 'Service item not found' });

    const today = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Reception visit service creation');

    const price = roundMoney(Number(serviceItem.price ?? 0));
    const qty = data.quantity;
    const discount = roundMoney(data.discountAmount);
    const gross = roundMoney(price * qty);
    if (discount > gross) {
      throw new HTTPException(400, { message: 'Discount cannot exceed service gross amount' });
    }
    const total = roundMoney(gross - discount);
    const serviceType = inferReceptionVisitServiceType(serviceItem);

    const result = await db.$client.prepare(`
      INSERT INTO visit_services
        (tenant_id, visit_id, patient_id, service_type, description, service_item_id, doctor_id, amount, discount_amount, quantity, total_amount, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', '+6 hours'))
    `).bind(
      tenantId, visitId, visit.patient_id,
      serviceType,
      data.description || serviceItem.item_name,
      data.serviceItemId,
      data.doctorId ?? visit.doctor_id ?? null,
      price, discount, qty, total,
      userId,
    ).run();

    const responseBody = {
      id: Number(result.meta.last_row_id),
      message: 'Service added to visit',
      serviceName: String(serviceItem.item_name),
      totalAmount: total,
    };
    await completeReceptionMutationIdempotency(c.env.DB, tenantId, idempotency, responseBody.id, responseBody);
    return c.json(responseBody, 201);
  } catch (error) {
    await failReceptionMutationIdempotency(c.env.DB, tenantId, idempotency);
    throw error;
  }
});

// ═══════════════════════════════════════════════════════════════════
// 3b. ADD MULTIPLE SERVICES TO A VISIT (Bulk Add)
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.post('/visits/:visitId/services/bulk', zValidator('json', addBulkServicesSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const visitId = Number(c.req.param('visitId'));
  const data = c.req.valid('json');
  assertReceptionDiscountAllowed(c, data.discountAmount);

  let serviceItemIds: number[];
  try {
    serviceItemIds = requireUniquePositiveIds(data.serviceItemIds, 'service item');
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid service item IDs' });
  }

  const idempotency = await beginReceptionMutationIdempotency({
    db: c.env.DB,
    tenantId,
    userId,
    mutationType: 'reception_visit_services_bulk',
    idempotencyKey: data.idempotencyKey,
    payload: { visitId, ...data, serviceItemIds, idempotencyKey: undefined },
    mismatchMessage: 'Idempotency key was already used for a different bulk service request',
    conflictMessage: 'Bulk service request is already being processed. Please retry shortly.',
  });
  if (idempotency.replay) return c.json({ ...idempotency.replay, idempotent: true }, 201);

  try {
    const visit = await fetchVisit(db, tenantId, visitId);
    if (!visit) throw new HTTPException(404, { message: 'Visit not found' });

    const today = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Reception bulk service creation');

    const serviceItemMap = await fetchServiceItems(db, tenantId, serviceItemIds);
    const missingServiceItemId = serviceItemIds.find((id) => !serviceItemMap.has(id));
    if (missingServiceItemId) {
      throw new HTTPException(404, { message: `Service item not found: ${missingServiceItemId}` });
    }
    const serviceItems = serviceItemIds.map((id) => ({ id, ...serviceItemMap.get(id)! })) as Array<{
      id: number;
      item_name: string;
      department_name?: string | null;
      price: number;
    }>;

    const doctorId = data.doctorId ?? visit.doctor_id ?? null;
    const qty = data.quantity;
    const grossAmounts = serviceItems.map((item) => roundMoney(Number(item.price ?? 0) * qty));
    let discounts: number[];
    try {
      discounts = allocateDiscountAcrossGrossAmounts(grossAmounts, roundMoney(data.discountAmount ?? 0));
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid bulk discount' });
    }

    const statements = serviceItems.map((serviceItem, index) => {
      const price = roundMoney(Number(serviceItem.price ?? 0));
      const itemDiscount = discounts[index];
      const total = roundMoney(grossAmounts[index] - itemDiscount);
      return db.$client.prepare(`
        INSERT INTO visit_services
          (tenant_id, visit_id, patient_id, service_type, description, service_item_id, doctor_id, amount, discount_amount, quantity, total_amount, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now', '+6 hours'))
      `).bind(
        tenantId,
        visitId,
        visit.patient_id,
        inferReceptionVisitServiceType(serviceItem),
        serviceItem.item_name,
        serviceItem.id,
        doctorId,
        price,
        itemDiscount,
        qty,
        total,
        userId,
      );
    });

    const batchResults = await db.$client.batch(statements);
    const results = serviceItems.map((serviceItem, index) => ({
      id: Number((batchResults[index] as { meta?: { last_row_id?: number } } | undefined)?.meta?.last_row_id ?? 0),
      serviceName: serviceItem.item_name,
      total: roundMoney(grossAmounts[index] - discounts[index]),
    }));
    const grandTotal = roundMoney(results.reduce((sum, result) => sum + result.total, 0));
    const responseBody = {
      message: `${results.length} service(s) added to visit`,
      services: results,
      totalCount: results.length,
      grandTotal,
    };
    await completeReceptionMutationIdempotency(
      c.env.DB,
      tenantId,
      idempotency,
      results[0]?.id || visitId,
      responseBody,
    );
    return c.json(responseBody, 201);
  } catch (error) {
    await failReceptionMutationIdempotency(c.env.DB, tenantId, idempotency);
    throw error;
  }
});

// ═══════════════════════════════════════════════════════════════════
// 4. ADD LAB ORDER AS A VISIT SERVICE (auto-creates lab order too)
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.post('/visits/:visitId/services/lab', zValidator('json', addLabServiceSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const visitId = Number(c.req.param('visitId'));
  const data = c.req.valid('json');
  assertReceptionDiscountAllowed(c, data.discountAmount);

  let labTestIds: number[];
  try {
    labTestIds = requireUniquePositiveIds(data.labTestIds, 'lab test');
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid lab test IDs' });
  }

  const idempotency = await beginReceptionMutationIdempotency({
    db: c.env.DB,
    tenantId,
    userId,
    mutationType: 'reception_visit_lab_order',
    idempotencyKey: data.idempotencyKey,
    payload: { visitId, ...data, labTestIds, idempotencyKey: undefined },
    mismatchMessage: 'Idempotency key was already used for a different reception lab order',
    conflictMessage: 'Reception lab order is already being processed. Please retry shortly.',
  });
  if (idempotency.replay) return c.json({ ...idempotency.replay, idempotent: true }, 201);

  try {
    const visit = await fetchVisit(db, tenantId, visitId);
    if (!visit) throw new HTTPException(404, { message: 'Visit not found' });

    const orderDate = data.orderDate ?? getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, orderDate, 'Reception lab visit service creation');

    const resolvedLabTests = await resolveLabTestBillingRows(c.env.DB, tenantId, labTestIds);
    const labTestMap = new Map(resolvedLabTests.map((test) => [test.id, test]));
    const missingLabTestId = labTestIds.find((id) => !labTestMap.has(id));
    if (missingLabTestId) {
      throw new HTTPException(404, { message: `Lab test not found: ${missingLabTestId}` });
    }
    const labTests = labTestIds.map((id) => labTestMap.get(id)!);

    const grossAmounts = labTests.map((test) => roundMoney(Number(test.price ?? 0)));
    let discounts: number[];
    try {
      discounts = allocateDiscountAcrossGrossAmounts(grossAmounts, roundMoney(data.discountAmount ?? 0));
    } catch (error) {
      throw new HTTPException(400, { message: error instanceof Error ? error.message : 'Invalid lab discount' });
    }

    const orderNo = await getNextSequence(c.env.DB, tenantId, 'lab_order', 'LO');
    const orderingClinicianDoctorId = await resolveOrderingClinicianDoctorId(c.env.DB, tenantId, {
      enteredByUserId: userId,
      explicitDoctorId: visit.doctor_id,
    });
    const statements: D1PreparedStatement[] = [
      db.$client.prepare(`
        INSERT INTO lab_orders (
          order_no, patient_id, visit_id, ordered_by,
          ordering_clinician_doctor_id, order_date, tenant_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(orderNo, visit.patient_id, visitId, userId, orderingClinicianDoctorId, orderDate, tenantId),
    ];

    for (const [index, test] of labTests.entries()) {
      const discount = discounts[index];
      const lineTotal = roundMoney(grossAmounts[index] - discount);
      statements.push(
        db.$client.prepare(`
          INSERT INTO lab_order_items
            (lab_order_id, lab_test_id, unit_price, discount, line_total, status, tenant_id, source)
          SELECT lo.id, ?, ?, ?, ?, 'pending', ?, 'lab'
          FROM lab_orders lo WHERE lo.tenant_id = ? AND lo.order_no = ?
        `).bind(test.id, test.price, discount, lineTotal, tenantId, tenantId, orderNo),
        db.$client.prepare(`
          INSERT INTO visit_services
            (tenant_id, visit_id, patient_id, service_type, description, service_item_id, doctor_id, amount,
             discount_amount, quantity, total_amount, reference_type, reference_id, status, created_by, created_at)
          SELECT ?, ?, ?, 'test', ?, ?, ?, ?, ?, 1, ?, 'lab_order_item', loi.id, 'pending', ?, datetime('now', '+6 hours')
          FROM lab_order_items loi
          JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
          WHERE lo.tenant_id = ? AND lo.order_no = ? AND loi.lab_test_id = ?
        `).bind(
          tenantId,
          visitId,
          visit.patient_id,
          test.name,
          test.billingServiceItemId,
          visit.doctor_id ?? null,
          test.price,
          discount,
          lineTotal,
          userId,
          tenantId,
          orderNo,
          test.id,
        ),
      );
    }

    await db.$client.batch(statements);
    const order = await db.$client.prepare(
      'SELECT id FROM lab_orders WHERE tenant_id = ? AND order_no = ? LIMIT 1',
    ).bind(tenantId, orderNo).first<{ id: number }>();
    const orderId = Number(order?.id ?? 0);
    if (!orderId) throw new HTTPException(500, { message: 'Lab order was not created' });

    const { results: createdItems } = await db.$client.prepare(`
      SELECT id, lab_test_id, line_total FROM lab_order_items
      WHERE tenant_id = ? AND lab_order_id = ?
      ORDER BY id ASC
    `).bind(tenantId, orderId).all<{ id: number; lab_test_id: number; line_total: number }>();
    const categoryByTestId = new Map(labTests.map((test) => [test.id, test.category]));
    const totalLabAmount = roundMoney(grossAmounts.reduce((sum, gross, index) => sum + gross - discounts[index], 0));

    const commissionTask = accrueLabOrderDoctorCommissions(c.env.DB, {
      tenantId,
      userId,
      patientId: visit.patient_id,
      visitId,
      billId: null,
      labOrderId: orderId,
      orderDate,
      items: (createdItems ?? []).map((item) => ({
        labOrderItemId: Number(item.id),
        labTestId: Number(item.lab_test_id),
        category: categoryByTestId.get(Number(item.lab_test_id)) ?? null,
        lineTotal: Number(item.line_total ?? 0),
      })),
    }).catch((error) => console.error('Failed to accrue reception lab order doctor commissions:', error));
    try {
      c.executionCtx.waitUntil(commissionTask);
    } catch {
      void commissionTask;
    }

    const responseBody = {
      orderId,
      orderNo,
      message: 'Lab order created and linked to visit',
      totalAmount: totalLabAmount,
    };
    await completeReceptionMutationIdempotency(c.env.DB, tenantId, idempotency, orderId, responseBody);
    return c.json(responseBody, 201);
  } catch (error) {
    await failReceptionMutationIdempotency(c.env.DB, tenantId, idempotency);
    throw error;
  }
});

// ═══════════════════════════════════════════════════════════════════
// 5. ADD PROCEDURE ORDER TO VISIT
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.post('/visits/:visitId/services/procedure', zValidator('json', addProcedureSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const visitId = Number(c.req.param('visitId'));
  const data = c.req.valid('json');
  assertReceptionDiscountAllowed(c, data.discountAmount);

  const idempotency = await beginReceptionMutationIdempotency({
    db: c.env.DB,
    tenantId,
    userId,
    mutationType: 'reception_visit_procedure_order',
    idempotencyKey: data.idempotencyKey,
    payload: { visitId, ...data, idempotencyKey: undefined },
    mismatchMessage: 'Idempotency key was already used for a different reception procedure order',
    conflictMessage: 'Reception procedure order is already being processed. Please retry shortly.',
  });
  if (idempotency.replay) return c.json({ ...idempotency.replay, idempotent: true }, 201);

  try {
    const visit = await fetchVisit(db, tenantId, visitId);
    if (!visit) throw new HTTPException(404, { message: 'Visit not found' });

    const serviceItem = await fetchServiceItem(db, tenantId, data.serviceItemId);
    if (!serviceItem) throw new HTTPException(404, { message: 'Service item not found' });
    const price = roundMoney(Number(serviceItem.price ?? 0));
    const qty = data.quantity;
    const discount = roundMoney(data.discountAmount);
    const gross = roundMoney(price * qty);
    if (discount > gross) throw new HTTPException(400, { message: 'Discount cannot exceed procedure gross amount' });
    const total = roundMoney(gross - discount);
    const today = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Reception procedure visit service creation');

    const orderNo = await getNextSequence(c.env.DB, tenantId, 'procedure', 'PRC');
    await db.$client.batch([
      db.$client.prepare(`
        INSERT INTO procedure_orders
          (tenant_id, order_no, patient_id, visit_id, service_item_id, procedure_name, instructions, ordered_by, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ordered', ?)
      `).bind(
        tenantId,
        orderNo,
        visit.patient_id,
        visitId,
        data.serviceItemId,
        data.procedureName,
        data.instructions || null,
        userId,
        userId,
      ),
      db.$client.prepare(`
        INSERT INTO visit_services
          (tenant_id, visit_id, patient_id, service_type, description, service_item_id, amount, discount_amount,
           quantity, total_amount, reference_type, reference_id, status, created_by, created_at)
        SELECT ?, ?, ?, 'procedure', ?, ?, ?, ?, ?, ?, 'procedure_order', po.id, 'pending', ?, datetime('now', '+6 hours')
        FROM procedure_orders po WHERE po.tenant_id = ? AND po.order_no = ?
      `).bind(
        tenantId,
        visitId,
        visit.patient_id,
        data.procedureName,
        data.serviceItemId,
        price,
        discount,
        qty,
        total,
        userId,
        tenantId,
        orderNo,
      ),
    ]);

    const procedure = await db.$client.prepare(
      'SELECT id FROM procedure_orders WHERE tenant_id = ? AND order_no = ? LIMIT 1',
    ).bind(tenantId, orderNo).first<{ id: number }>();
    const procedureId = Number(procedure?.id ?? 0);
    if (!procedureId) throw new HTTPException(500, { message: 'Procedure order was not created' });

    const responseBody = {
      procedureId,
      orderNo,
      message: 'Procedure ordered and linked to visit',
      totalAmount: total,
    };
    await completeReceptionMutationIdempotency(c.env.DB, tenantId, idempotency, procedureId, responseBody);
    return c.json(responseBody, 201);
  } catch (error) {
    await failReceptionMutationIdempotency(c.env.DB, tenantId, idempotency);
    throw error;
  }
});

// ═══════════════════════════════════════════════════════════════════
// 6. LIST SERVICES FOR A VISIT
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/visits/:visitId/services', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const visitId = Number(c.req.param('visitId'));

  const { results } = await db.$client.prepare(`
    SELECT vs.*, si.item_name as service_name, si.item_code, d.name as doctor_name
    FROM visit_services vs
    LEFT JOIN billing_service_items si ON vs.service_item_id = si.id
    LEFT JOIN doctors d ON vs.doctor_id = d.id
    WHERE vs.visit_id = ? AND vs.tenant_id = ?
    ORDER BY vs.created_at DESC
  `).bind(visitId, tenantId).all();

  const pendingTotal = (results as any[])
    .filter((r: any) => r.status === 'pending')
    .reduce((sum: number, r: any) => sum + (r.total_amount || 0), 0);

  return c.json({ services: results, pendingTotal });
});

// ═══════════════════════════════════════════════════════════════════
// 7. GENERATE BILL FROM VISIT SERVICES
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.post('/visits/:visitId/generate-bill', zValidator('json', generateBillSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const visitId = Number(c.req.param('visitId'));
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  const mutationType = 'reception_visit_bill';

  const visit = await fetchVisit(db, tenantId, visitId);
  if (!visit) throw new HTTPException(404, { message: 'Visit not found' });
  assertReceptionDiscountAllowed(c, data.discount);

  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ visitId, ...data, idempotencyKey: undefined })
    : null;
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different reception bill request',
      conflictMessage: 'Reception bill request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);

    const reservedReplay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different reception bill request',
      conflictMessage: 'Reception bill request is already being processed. Please retry shortly.',
    });
    if (reservedReplay) return c.json({ ...reservedReplay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  try {
    const { results: pendingServices } = await db.$client.prepare(`
      SELECT * FROM visit_services
      WHERE visit_id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(visitId, tenantId).all();

    if (!pendingServices || pendingServices.length === 0) {
      throw new HTTPException(400, { message: 'No pending services to bill' });
    }

    await assertAccountingPeriodOpen(
      c.env.DB,
      tenantId,
      today,
      'Reception visit-service bill generation',
    );

    const services = pendingServices as Array<Record<string, unknown>>;
    const subtotal = roundMoney(services.reduce((sum, service) => (
      sum + Number(service.total_amount || 0)
    ), 0));
    const discount = roundMoney(data.discount ?? 0);
    if (discount > subtotal) {
      throw new HTTPException(400, { message: 'Bill discount cannot exceed pending service subtotal' });
    }
    assertDiscountReferralNameForHighDiscount(subtotal, discount, data.discountByName);

    const schemeApplication = data.schemeApplication ?? null;
    const schemeEligibility = schemeApplication && discount > 0
      ? await evaluateBillingSchemeEligibility(c.env.DB, {
        tenantId,
        patientId: visit.patient_id,
        schemeId: schemeApplication.schemeId ?? null,
        schemeCode: schemeApplication.schemeCode ?? null,
        memberCode: schemeApplication.memberCode ?? null,
        serviceCategory: schemeApplication.serviceCategory ?? 'reception_visit_bill',
        subtotal,
      })
      : null;

    if (schemeEligibility && !schemeEligibility.eligible) {
      throw new HTTPException(400, {
        message: ['Scheme is not eligible', ...schemeEligibility.blockers].join(': '),
      });
    }
    if (schemeEligibility && discount - schemeEligibility.suggested_discount > 0.01) {
      throw new HTTPException(400, { message: 'Scheme discount exceeds eligible scheme cap.' });
    }

    const requestedDiscountAllocations = (data.discountAllocations ?? [])
      .map((allocation) => {
        const reason = normalizeDiscountReason(allocation.reason);
        const amount = roundMoney(allocation.amount);
        return amount > 0
          ? {
            reason,
            allocationType: discountAllocationTypeForReason(reason),
            amount,
            doctorId: allocation.doctorId ?? null,
            note: allocation.note?.trim() || null,
          }
          : null;
      })
      .filter((row): row is {
        reason: ReturnType<typeof normalizeDiscountReason>;
        allocationType: ReturnType<typeof discountAllocationTypeForReason>;
        amount: number;
        doctorId: number | null;
        note: string | null;
      } => Boolean(row));
    if (
      schemeEligibility
      && schemeEligibility.allocation_type !== 'doctor_commission_waiver'
      && requestedDiscountAllocations.some(
        (allocation) => allocation.allocationType === 'doctor_commission_waiver',
      )
    ) {
      throw new HTTPException(400, {
        message: 'Doctor commission waiver cannot be mixed with a Billing Master scheme discount. Remove the scheme or remove the doctor waiver allocation.',
      });
    }

    const discountAllocationRows = discount > 0
      ? (requestedDiscountAllocations.length > 0
        ? requestedDiscountAllocations
        : [{
          reason: normalizeDiscountReason('normal_hospital_discount'),
          allocationType: schemeEligibility?.allocation_type
            ?? discountAllocationTypeForReason(normalizeDiscountReason('normal_hospital_discount')),
          amount: roundMoney(discount),
          doctorId: null,
          note: schemeEligibility?.scheme_name ? `Scheme: ${schemeEligibility.scheme_name}` : null,
        }])
      : [];
    const allocationTotal = roundMoney(
      discountAllocationRows.reduce((sum, row) => sum + row.amount, 0),
    );
    if (discount > 0 && Math.abs(allocationTotal - roundMoney(discount)) > 0.01) {
      throw new HTTPException(400, { message: 'Discount allocation total must match bill discount.' });
    }

    const total = Math.max(0, subtotal - discount);
    const categoryTotals = calculateBillCategoryTotals(
      services.map((service) => ({
        category: String(service.service_type ?? ''),
        amount: Number(service.total_amount ?? 0),
      })),
    );
    const preparedDiscountAllocations = discountAllocationRows.map((allocation) => ({
      allocationType: allocation.allocationType,
      reason: allocation.reason,
      doctorId: allocation.doctorId,
      amount: allocation.amount,
      referenceName: data.discountByName?.trim() || null,
      note: allocation.note,
      metadataJson: JSON.stringify({
        source: 'reception_visit_bill',
        schemeId: schemeEligibility?.scheme_id ?? null,
        schemeMemberId: schemeEligibility?.matched_member_id ?? null,
      }),
    }));
    const preparationInput: ReceptionVisitBillingPreparationInput = {
      tenantId,
      userId: Number(userId),
      visitId,
      patientId: visit.patient_id,
      visitDoctorId: visit.doctor_id ?? null,
      businessDate: today,
      issuedAtUtc: new Date().toISOString(),
      subtotal,
      discount,
      discountByName: data.discountByName?.trim() || null,
      total,
      categoryTotals,
      discountAllocations: preparedDiscountAllocations,
      services: services.map((service) => ({
        id: Number(service.id),
        patientId: Number(service.patient_id),
        visitId: Number(service.visit_id),
        serviceType: String(service.service_type ?? ''),
        description: String(service.description ?? ''),
        serviceItemId: service.service_item_id == null ? null : Number(service.service_item_id),
        doctorId: service.doctor_id == null ? null : Number(service.doctor_id),
        amount: Number(service.amount ?? 0),
        discountAmount: Number(service.discount_amount ?? 0),
        quantity: Number(service.quantity ?? 1),
        totalAmount: Number(service.total_amount ?? 0),
        referenceType: service.reference_type == null ? null : String(service.reference_type),
        referenceId: service.reference_id == null ? null : Number(service.reference_id),
      })),
      dependencies: {
        assertAccountingPeriodOpen: async () => undefined,
        nextInvoiceNo: () => getNextBillInvoiceNumber(c.env.DB, tenantId, categoryTotals),
      },
    };
    const contextRef: { current: ReceptionVisitBillingContext | null } = { current: null };
    const legacyBillIdRef: { current: number | null } = { current: null };

    const financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId,
      boundary: 'reception.visit-billing.create',
      legacyExecutor: async () => {
        const legacy = await executeReceptionVisitBillingOriginalLegacy(c.env.DB, preparationInput);
        contextRef.current = legacy.context;
        legacyBillIdRef.current = legacy.billId;
        return [...legacy.results];
      },
      strictAuthoritativeStatements: async () => {
        contextRef.current = await prepareReceptionVisitBillingStrictContext(c.env.DB, preparationInput);
        return prepareReceptionVisitBillingStrictStatements(c.env.DB, contextRef.current);
      },
      canonical: async (execution) => {
        const context = contextRef.current;
        if (!context) throw new Error('Reception visit billing context is unavailable');
        return createReceptionVisitBilling(c.env.DB, {
          tenantId,
          commandIdempotencyKey: `reception-visit-billing:${visitId}:${context.invoiceNo}`,
          invoiceNo: context.invoiceNo,
          legacyPatientId: context.patientId,
          legacyVisitId: context.visitId,
          issuedAtUtc: context.issuedAtUtc,
          businessDate: context.businessDate,
          billDiscountMinor: toMinorUnits(context.discount),
          lines: context.services.map((service, index) => ({
            lineNumber: index + 1,
            visitServiceId: service.id,
            billingServiceItemId: Number(service.serviceItemId ?? 0),
            serviceType: service.serviceType,
            description: service.description,
            legacyReferenceId: service.referenceType === 'lab_order_item'
              ? service.referenceId
              : service.serviceItemId ?? service.referenceId,
            quantity: service.quantity,
            lineTotalMinor: toMinorUnits(service.totalAmount),
          })),
        }, {
          authoritativeStatements: execution.authoritativeStatements,
        });
      },
    });

    const context = contextRef.current;
    if (!context) throw new Error('Committed reception visit billing context is unavailable');
    const createdBill = await c.env.DB.prepare(
      'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? LIMIT 1',
    ).bind(tenantId, context.invoiceNo).first<{ id: number }>();
    const billId = Number(createdBill?.id ?? legacyBillIdRef.current ?? 0);
    if (!(billId > 0)) {
      throw new HTTPException(409, {
        message: 'Services were already billed by another request. Please refresh and try again.',
      });
    }

    const { results: committedInvoiceItemRows } = await c.env.DB.prepare(`
      SELECT id
      FROM invoice_items
      WHERE tenant_id = ? AND bill_id = ?
      ORDER BY id ASC
    `).bind(tenantId, billId).all<{ id: number }>();
    const committedInvoiceItems = (committedInvoiceItemRows ?? []).map((row) => ({
      id: Number(row.id),
    }));
    if (
      financialExecution.mode === 'strict'
      && (
        committedInvoiceItems.length !== context.services.length
        || committedInvoiceItems.some((item) => !(item.id > 0))
      )
    ) {
      throw new Error('Committed reception invoice items could not be resolved');
    }

    if (schemeEligibility && context.discount > 0) {
      await recordBillingSchemeUsage(c.env.DB, {
        tenantId,
        schemeId: schemeEligibility.scheme_id!,
        memberId: schemeEligibility.matched_member_id ?? null,
        patientId: context.patientId,
        billId,
        serviceCategory: schemeEligibility.service_category ?? 'reception_visit_bill',
        subtotal: context.subtotal,
        discountAmount: context.discount,
        allocationType: schemeEligibility.allocation_type,
        createdBy: userId,
      });
    }

    if (context.total > 0) {
      await recordBillFinalizationSideEffects(c.env.DB, {
        tenantId,
        userId,
        patientId: context.patientId,
        visitId: context.visitId,
        billId,
        invoiceNo: context.invoiceNo,
        referringDoctorId: context.visitDoctorId,
        billDate: context.businessDate,
        subtotal: context.subtotal,
        discount: context.discount,
        total: context.total,
        categoryTotals: context.categoryTotals,
        doctorCommissionWaivers: context.discountAllocations
          .filter((allocation) => (
            allocation.allocationType === 'doctor_commission_waiver' && allocation.doctorId
          ))
          .map((allocation) => ({
            doctorId: Number(allocation.doctorId),
            amount: allocation.amount,
          })),
        extraPayload: {
          discountAllocations: context.discountAllocations.map((allocation) => ({
            allocationType: allocation.allocationType,
            doctorId: allocation.doctorId,
            amount: allocation.amount,
          })),
        },
        skipBillAccountingEvent: financialExecution.mode === 'strict',
        items: context.services.map((service, index) => ({
          itemCategory: service.serviceType,
          description: service.description || null,
          lineTotal: service.totalAmount,
          referenceId: service.referenceType === 'lab_order_item'
            ? service.referenceId
            : service.serviceItemId ?? service.referenceId,
          ...(financialExecution.mode === 'strict'
            ? { billItemId: committedInvoiceItems[index]?.id }
            : {}),
        })),
      });
      queueReceptionAccountingPosting(c, tenantId);
    }

    await createAuditLog(c.env, tenantId, userId, 'CREATE', 'bills', billId, null, {
      patientId: context.patientId,
      visitId: context.visitId,
      invoiceNo: context.invoiceNo,
      total: context.total,
      serviceCount: context.services.length,
    });

    const responseBody = {
      message: 'Bill generated from visit services',
      billId,
      invoiceNo: context.invoiceNo,
      total: context.total,
      serviceCount: services.length,
    };

    if (data.idempotencyKey && idempotencyReserved) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
        sourceId: billId,
        responseBody,
      });
    }

    return c.json(responseBody, 201);
  } catch (error) {
    if (data.idempotencyKey && idempotencyReserved) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      });
    }
    if (error instanceof HTTPException) throw error;
    if (error instanceof ReceptionVisitBillingError) {
      throw new HTTPException(error.status, { message: error.message });
    }
    if (isFinancialBatchAssertionError(error) || isReceptionVisitCanonicalConflict(error)) {
      throw new HTTPException(409, {
        message: 'Reception visit services changed concurrently or canonical authority is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }
});

// 8. RECEPTIONIST DAILY REPORT
// ═══════════════════════════════════════════════════════════════════

const localReportDate = (column: string) => `date(${column}, '+6 hours')`;

receptionRoutes.get('/daily-report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const staffId = c.req.query('staff_id');

  // Overall collection by category
  const categorySql = `
    SELECT ii.item_category,
           SUM(ii.line_total) as total_amount,
           COUNT(*) as item_count
    FROM bills b
    JOIN invoice_items ii ON b.id = ii.bill_id AND ii.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
    ${staffId ? 'AND b.created_by = ?' : ''}
      AND COALESCE(ii.status, 'active') != 'cancelled'
    GROUP BY ii.item_category
  `;
  const catParams: (string | number)[] = [tenantId, date];
  if (staffId) catParams.push(Number(staffId));

  const { results: byCategory } = await db.$client.prepare(categorySql).bind(...catParams).all();

  // Payment method breakdown
  const methodSql = `
    WITH payment_by_method AS (
      SELECT
        COALESCE(NULLIF(TRIM(p.payment_method), ''), 'cash') AS payment_method,
        COALESCE(SUM(p.amount), 0) AS total_amount,
        COUNT(*) AS transaction_count
      FROM payments p
      JOIN bills b ON p.bill_id = b.id AND p.tenant_id = b.tenant_id
      WHERE p.tenant_id = ? AND date(COALESCE(p.date, p.created_at)) = date(?)
      ${staffId ? 'AND p.received_by = ?' : ''}
      GROUP BY COALESCE(NULLIF(TRIM(p.payment_method), ''), 'cash')
    ),
    refund_by_method AS (
      SELECT
        COALESCE(NULLIF(TRIM(ect.payment_method), ''), 'cash') AS payment_method,
        COALESCE(SUM(ABS(ect.amount)), 0) AS refund_amount
      FROM emp_cash_transactions ect
      WHERE ect.tenant_id = ?
        AND ect.transaction_type = 'SalesReturn'
        AND ${localReportDate('ect.transaction_date, ect.created_at')} = date(?)
        ${staffId ? 'AND ect.employee_id = ?' : ''}
      GROUP BY COALESCE(NULLIF(TRIM(ect.payment_method), ''), 'cash')
    )
    SELECT
      payment_by_method.payment_method,
      MAX(0, payment_by_method.total_amount - COALESCE(refund_by_method.refund_amount, 0)) AS total_amount,
      payment_by_method.transaction_count
    FROM payment_by_method
    LEFT JOIN refund_by_method ON refund_by_method.payment_method = payment_by_method.payment_method
    ORDER BY total_amount DESC
  `;
  const methodParams: (string | number)[] = [tenantId, date];
  if (staffId) methodParams.push(Number(staffId));
  methodParams.push(tenantId, date);
  if (staffId) methodParams.push(Number(staffId));

  const { results: byMethod } = await db.$client.prepare(methodSql).bind(...methodParams).all();

  // Doctor-wise collection. Keep combined total for legacy widgets,
  // and expose separate consultation/test referral buckets for the reception breakdown UI.
  const doctorBaseWhere = `
    WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
    ${staffId ? 'AND b.created_by = ?' : ''}
    AND d.name IS NOT NULL
  `;
  const doctorTestBaseWhere = `
    WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
    ${staffId ? 'AND b.created_by = ?' : ''}
  `;
  const doctorSql = `
    SELECT d.name as doctor_name,
           SUM(vs.total_amount) as total_amount,
           COUNT(vs.id) as service_count
    FROM bills b
    JOIN visit_services vs ON vs.bill_id = b.id AND vs.tenant_id = b.tenant_id
    LEFT JOIN doctors d ON vs.doctor_id = d.id AND d.tenant_id = b.tenant_id
    ${doctorBaseWhere}
    GROUP BY d.name
  `;
  const doctorConsultationSql = `
    SELECT d.name as doctor_name,
           SUM(vs.total_amount) as total_amount,
           COUNT(vs.id) as service_count
    FROM bills b
    JOIN visit_services vs ON vs.bill_id = b.id AND vs.tenant_id = b.tenant_id
    LEFT JOIN doctors d ON vs.doctor_id = d.id AND d.tenant_id = b.tenant_id
    ${doctorBaseWhere}
      AND vs.service_type = 'doctor_visit'
    GROUP BY d.name
  `;
  const doctorTestSql = `
    SELECT COALESCE(d.name, 'Walk-in / Unassigned') as doctor_name,
           SUM(vs.total_amount) as total_amount,
           COUNT(vs.id) as service_count
    FROM bills b
    JOIN visit_services vs ON vs.bill_id = b.id AND vs.tenant_id = b.tenant_id
    LEFT JOIN visits v ON v.id = COALESCE(vs.visit_id, b.visit_id) AND v.tenant_id = b.tenant_id
    LEFT JOIN doctors d ON d.id = COALESCE(vs.doctor_id, b.referring_doctor_id, v.doctor_id) AND d.tenant_id = b.tenant_id
    ${doctorTestBaseWhere}
      AND vs.service_type = 'test'
    GROUP BY COALESCE(d.name, 'Walk-in / Unassigned')
  `;
  const doctorOtherSql = `
    SELECT d.name as doctor_name,
           SUM(vs.total_amount) as total_amount,
           COUNT(vs.id) as service_count
    FROM bills b
    JOIN visit_services vs ON vs.bill_id = b.id AND vs.tenant_id = b.tenant_id
    LEFT JOIN doctors d ON vs.doctor_id = d.id AND d.tenant_id = b.tenant_id
    ${doctorBaseWhere}
      AND vs.service_type NOT IN ('doctor_visit', 'test')
    GROUP BY d.name
  `;
  const docParams: (string | number)[] = [tenantId, date];
  if (staffId) docParams.push(Number(staffId));

  const { results: byDoctor } = await db.$client.prepare(doctorSql).bind(...docParams).all();
  const { results: byDoctorConsultation } = await db.$client.prepare(doctorConsultationSql).bind(...docParams).all();
  const { results: byDoctorTest } = await db.$client.prepare(doctorTestSql).bind(...docParams).all();
  const { results: byDoctorOther } = await db.$client.prepare(doctorOtherSql).bind(...docParams).all();

  // Grand totals: invoice volume is based on bills created on the report date.
  // Collection KPIs are based on payment rows from the report date so due
  // collections against older invoices are not hidden from Total Cash Received.
  const totals = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(b.total), 0) as total_billed,
      COALESCE(SUM(b.paid), 0) as total_paid,
      COALESCE(SUM(CASE
        WHEN COALESCE(b.total, 0) - COALESCE(b.paid, 0) > 0
        THEN COALESCE(b.total, 0) - COALESCE(b.paid, 0)
        ELSE 0
      END), 0) as total_due,
      COUNT(*) as bill_count,
      SUM(CASE WHEN COALESCE(b.status, '') = 'paid' OR COALESCE(b.paid, 0) >= COALESCE(b.total, 0) THEN 1 ELSE 0 END) as paid_bill_count
    FROM bills b
    WHERE b.tenant_id = ? AND ${localReportDate('b.created_at')} = date(?)
    ${staffId ? 'AND b.created_by = ?' : ''}
  `).bind(...(staffId ? [tenantId, date, Number(staffId)] : [tenantId, date])).first<{
    total_billed: number; total_paid: number; total_due: number; bill_count: number; paid_bill_count: number;
  }>();

  // Collection split: current billing vs due collection received today.
  // Explicit payment_type='due' counts as due collection; payments against
  // bills created before the selected date also count as due collection for
  // legacy rows where payment_type may be missing or incorrect.
  const paymentTotalsParams: (string | number)[] = [date, date, tenantId, date];
  if (staffId) paymentTotalsParams.push(Number(staffId));
  paymentTotalsParams.push(tenantId, date);
  if (staffId) paymentTotalsParams.push(Number(staffId));
  const paymentTotals = await db.$client.prepare(`
    WITH payment_totals AS (
      SELECT
        COALESCE(SUM(CASE
          WHEN COALESCE(p.payment_type, 'current') = 'due'
            OR (b.id IS NOT NULL AND b.created_at IS NOT NULL AND ${localReportDate('b.created_at')} < date(?))
          THEN 0 ELSE p.amount END), 0) as billing_collection,
        COALESCE(SUM(CASE
          WHEN COALESCE(p.payment_type, 'current') = 'due'
            OR (b.id IS NOT NULL AND b.created_at IS NOT NULL AND ${localReportDate('b.created_at')} < date(?))
          THEN p.amount ELSE 0 END), 0) as due_collection,
        COALESCE(SUM(p.amount), 0) as total_collection
      FROM payments p
      JOIN bills b ON p.bill_id = b.id AND p.tenant_id = b.tenant_id
      WHERE p.tenant_id = ?
        AND date(COALESCE(p.date, p.created_at)) = date(?)
        ${staffId ? 'AND p.received_by = ?' : ''}
    ),
    refund_total AS (
      SELECT COALESCE(SUM(ABS(ect.amount)), 0) AS total
      FROM emp_cash_transactions ect
      WHERE ect.tenant_id = ?
        AND ect.transaction_type = 'SalesReturn'
        AND ${localReportDate('ect.transaction_date, ect.created_at')} = date(?)
        ${staffId ? 'AND ect.employee_id = ?' : ''}
    )
    SELECT
      MAX(0, payment_totals.billing_collection - refund_total.total) AS billing_collection,
      payment_totals.due_collection,
      MAX(0, payment_totals.total_collection - refund_total.total) AS total_collection
    FROM payment_totals, refund_total
  `).bind(...paymentTotalsParams).first<{
    billing_collection: number; due_collection: number; total_collection: number;
  }>();

  const depositTotals = await db.$client.prepare(`
    SELECT COALESCE(SUM(amount), 0) as deposit_received
    FROM billing_deposits
    WHERE tenant_id = ?
      AND ${localReportDate('created_at')} = date(?)
      AND transaction_type = 'deposit'
      AND COALESCE(is_active, 1) = 1
      ${staffId ? 'AND created_by = ?' : ''}
  `).bind(...(staffId ? [tenantId, date, Number(staffId)] : [tenantId, date])).first<{ deposit_received: number }>();
  const dueCollection = Number(paymentTotals?.due_collection ?? 0);
  const totalPaymentCollection = Number(paymentTotals?.total_collection ?? 0);
  const billingCollection = Number(paymentTotals?.billing_collection ?? 0);
  const depositReceived = Number(depositTotals?.deposit_received ?? 0);

  return c.json({
    date,
    staff_id: staffId ?? null,
    summary: {
      totalBilled: totals?.total_billed ?? 0,
      totalPaid: billingCollection,
      dueCollection,
      totalDue: totals?.total_due ?? 0,
      billCount: totals?.bill_count ?? 0,
      paidBillCount: totals?.paid_bill_count ?? 0,
      depositReceived,
      totalCashReceived: totalPaymentCollection + depositReceived,
    },
    byCategory,
    byPaymentMethod: byMethod,
    byDoctor,
    byDoctorConsultation,
    byDoctorTest,
    byDoctorOther,
  });
});

// ═══════════════════════════════════════════════════════════════════

function parseReceptionSnapshotPendingLabItems(value: unknown): Array<{ id: number; testName: string; lineTotal: number }> {
  if (!value || typeof value !== 'string') return [];
  return value.split('||').filter(Boolean).map((entry) => {
    const [id, testName, lineTotal] = entry.split('::');
    return { id: Number(id), testName: testName || 'Test', lineTotal: Number(lineTotal ?? 0) };
  }).filter((item) => Number.isFinite(item.id) && item.id > 0);
}

receptionRoutes.get('/dashboard-snapshot', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const date = c.req.query('date') || getTodayGMT6();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HTTPException(400, { message: 'Invalid date format. Expected YYYY-MM-DD.' });

  const visitsPromise = c.env.DB.prepare(`
    SELECT v.*, p.name as patient_name, p.patient_code, p.mobile, p.age, p.date_of_birth,
           d.name as doctor_name,
           (SELECT COUNT(*) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending') as pending_services,
           (SELECT COALESCE(SUM(vs.total_amount), 0) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending') as pending_amount,
           (SELECT COUNT(*) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending' AND vs.service_type = 'doctor_visit') as pending_doctor_visit_services,
           (SELECT COALESCE(SUM(vs.total_amount), 0) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending' AND vs.service_type = 'doctor_visit') as pending_doctor_visit_amount,
           lb.id as bill_id, lb.invoice_no, COALESCE(lb.total, 0) as bill_total,
           COALESCE(lb.paid, 0) as bill_paid, COALESCE(lb.due, 0) as bill_due, lb.status as bill_status
    FROM visits v
    JOIN patients p ON v.patient_id = p.id
    LEFT JOIN doctors d ON v.doctor_id = d.id
    LEFT JOIN bills lb ON lb.id = (
      SELECT b.id FROM bills b
      WHERE b.tenant_id = v.tenant_id AND b.visit_id = v.id AND (b.status IS NULL OR b.status NOT IN ('cancelled', 'refunded', 'draft'))
      ORDER BY b.created_at DESC, b.id DESC LIMIT 1
    )
    WHERE v.tenant_id = ? AND v.visit_date >= ? AND v.visit_date < date(?, '+1 day')
    ORDER BY v.created_at DESC LIMIT 50
  `).bind(tenantId, date, date).all<Record<string, unknown>>();

  const appointmentsPromise = c.env.DB.prepare(`
    SELECT a.*, p.name AS patient_name, p.patient_code, p.mobile AS patient_mobile, p.age AS patient_age,
           p.date_of_birth AS patient_date_of_birth, d.name AS doctor_name,
           lb.id AS bill_id, lb.invoice_no AS invoice_no, lb.total AS bill_total, lb.paid AS bill_paid, lb.due AS bill_due, lb.status AS bill_status
    FROM appointments a
    JOIN patients p ON a.patient_id = p.id
    LEFT JOIN doctors d ON a.doctor_id = d.id
    LEFT JOIN bills lb ON lb.id = (
      SELECT bpi.billed_bill_id FROM billing_provisional_items bpi
      WHERE bpi.tenant_id = a.tenant_id AND bpi.appointment_id = a.id AND bpi.billed_bill_id IS NOT NULL
        AND COALESCE(bpi.is_active, 1) = 1 AND bpi.bill_status IN ('finalized', 'billed')
      ORDER BY bpi.id DESC LIMIT 1
    )
    WHERE a.tenant_id = ? AND a.appt_date = ?
    ORDER BY a.created_at DESC, a.id DESC, a.token_no DESC
  `).bind(tenantId, date).all<Record<string, unknown>>();

  const queueStatsPromise = c.env.DB.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END), 0) AS waiting,
      COALESCE(SUM(CASE WHEN status IN ('serving', 'called') THEN 1 ELSE 0 END), 0) AS serving,
      COALESCE(SUM(CASE WHEN status = 'called' THEN 1 ELSE 0 END), 0) AS called,
      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END), 0) AS no_show,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled
    FROM queue_entries WHERE tenant_id = ? AND queue_date = ?
  `).bind(tenantId, date).first<Record<string, unknown>>();

  const pendingLabOrdersPromise = c.env.DB.prepare(`
    SELECT lo.id AS order_id, lo.order_no, lo.prescription_id, p.rx_no, lo.patient_id,
      pt.name AS patient_name, pt.patient_code, pt.mobile AS patient_mobile,
      d.id AS doctor_id, d.name AS doctor_name, lo.order_date, lo.created_at,
      COUNT(loi.id) AS pending_item_count,
      COALESCE(SUM(COALESCE(NULLIF(loi.line_total, 0), loi.unit_price, ltc.price, 0)), 0) AS pending_amount,
      GROUP_CONCAT(loi.id || '::' || COALESCE(NULLIF(loi.test_name, ''), ltc.name, 'Test #' || loi.lab_test_id) || '::' || COALESCE(NULLIF(loi.line_total, 0), loi.unit_price, ltc.price, 0), '||') AS pending_items
    FROM lab_orders lo
    JOIN patients pt ON pt.id = lo.patient_id AND pt.tenant_id = lo.tenant_id
    JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
    LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = lo.tenant_id
    LEFT JOIN prescriptions p ON p.id = lo.prescription_id AND p.tenant_id = lo.tenant_id
    LEFT JOIN doctors d ON d.id = p.doctor_id AND d.tenant_id = lo.tenant_id
    WHERE lo.tenant_id = ? AND lo.prescription_id IS NOT NULL
      AND COALESCE(loi.status, 'pending') NOT IN ('cancelled', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items ii JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
        WHERE ii.tenant_id = lo.tenant_id AND ii.reference_id = loi.id AND ii.item_category = 'test'
          AND COALESCE(ii.status, 'active') = 'active' AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      )
    GROUP BY lo.id HAVING pending_item_count > 0
    ORDER BY lo.created_at DESC, lo.id DESC LIMIT 10
  `).bind(tenantId).all<Record<string, unknown>>();

  const activeCounterPromise = loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });

  const [visitsResult, appointmentsResult, queueStats, pendingLabOrdersResult, activeCounter] = await Promise.all([
    visitsPromise, appointmentsPromise, queueStatsPromise, pendingLabOrdersPromise, activeCounterPromise,
  ]);

  const session = activeCounter ? {
    id: Number(activeCounter.id),
    counterId: Number(activeCounter.counter_id),
    counterName: activeCounter.counter_name,
    counterCode: activeCounter.counter_code,
    counterType: activeCounter.counter_type,
    openingCash: Number(activeCounter.opening_cash ?? 0),
    openedAt: activeCounter.opened_at,
  } : null;

  return c.json({
    date,
    generatedAt: new Date().toISOString(),
    visits: { visits: (visitsResult.results ?? []).filter((visit) => visit.id != null) },
    appointments: { appointments: appointmentsResult.results ?? [], date },
    queueStats: { Results: {
      total: Number(queueStats?.total ?? 0), waiting: Number(queueStats?.waiting ?? 0),
      serving: Number(queueStats?.serving ?? 0), called: Number(queueStats?.called ?? 0),
      completed: Number(queueStats?.completed ?? 0), no_show: Number(queueStats?.no_show ?? 0),
      cancelled: Number(queueStats?.cancelled ?? 0),
    } },
    pendingLabOrders: { data: (pendingLabOrdersResult.results ?? []).map((row) => ({
      orderId: Number(row.order_id), orderNo: row.order_no,
      prescriptionId: row.prescription_id != null ? Number(row.prescription_id) : null,
      rxNo: row.rx_no, patientId: Number(row.patient_id), patientName: row.patient_name,
      patientCode: row.patient_code, patientMobile: row.patient_mobile,
      doctorId: row.doctor_id != null ? Number(row.doctor_id) : null, doctorName: row.doctor_name,
      orderDate: row.order_date, createdAt: row.created_at ?? null,
      pendingItemCount: Number(row.pending_item_count ?? 0), pendingAmount: Number(row.pending_amount ?? 0),
      items: parseReceptionSnapshotPendingLabItems(row.pending_items),
    })) },
    activeCounter: { active: Boolean(session), session },
  });
});

// 9. VISIT LIST FOR RECEPTION (with pending services count)
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/visits', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const search = c.req.query('search') || '';
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);

  const billDepositAdjustedExpression = `COALESCE((
    SELECT SUM(bd.amount)
    FROM billing_deposits bd
    WHERE bd.tenant_id = b.tenant_id
      AND bd.reference_bill_id = b.id
      AND bd.transaction_type = 'adjustment'
      AND bd.is_active = 1
  ), 0)`;
  const billSettledAmountExpression = `(COALESCE(b.paid, 0) + ${billDepositAdjustedExpression})`;
  const billCalculatedPendingExpression = `MAX(0, COALESCE(b.total, 0) - ${billSettledAmountExpression})`;
  const billPendingAmountExpression = `MIN(MAX(0, COALESCE(b.due, ${billCalculatedPendingExpression})), ${billCalculatedPendingExpression})`;

  let sql = `
    SELECT v.*, p.name as patient_name, p.patient_code, p.mobile, p.age, p.date_of_birth,
           d.name as doctor_name,
           COALESCE(lb.referred_by_type, 'self') as referred_by_type,
           lb.referred_by_name as referred_by_name,
           lb.referring_doctor_id as referring_doctor_id,
           rd.name as referred_by_doctor_name,
           (SELECT COUNT(*) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending') as pending_services,
           (SELECT COALESCE(SUM(vs.total_amount), 0) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending') as pending_amount,
           (SELECT COUNT(*) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending' AND vs.service_type = 'doctor_visit') as pending_doctor_visit_services,
           (SELECT COALESCE(SUM(vs.total_amount), 0) FROM visit_services vs WHERE vs.visit_id = v.id AND vs.status = 'pending' AND vs.service_type = 'doctor_visit') as pending_doctor_visit_amount,
           COALESCE(bs.latest_bill_id, lb.id) as bill_id,
           COALESCE(bs.latest_invoice_no, lb.invoice_no) as invoice_no,
           COALESCE(bs.total_amount, lb.total, 0) as bill_total,
           COALESCE(bs.settled_amount, lb.paid, 0) as bill_paid,
           COALESCE(bs.outstanding, lb.due, 0) as bill_due,
           CASE
             WHEN COALESCE(bs.outstanding, lb.due, 0) > 0 THEN 'open'
             ELSE lb.status
           END as bill_status,
           COALESCE(bs.bill_count, CASE WHEN lb.id IS NULL THEN 0 ELSE 1 END, 0) as bill_count,
           COALESCE(bs.due_bill_count, CASE WHEN COALESCE(lb.due, 0) > 0 THEN 1 ELSE 0 END, 0) as due_bill_count
    FROM visits v
    JOIN patients p ON v.patient_id = p.id
    LEFT JOIN doctors d ON v.doctor_id = d.id
    LEFT JOIN (
      SELECT
        b.tenant_id,
        b.visit_id,
        COUNT(*) as bill_count,
        SUM(COALESCE(b.total, 0)) as total_amount,
        SUM(${billSettledAmountExpression}) as settled_amount,
        SUM(${billPendingAmountExpression}) as outstanding,
        SUM(CASE WHEN ${billPendingAmountExpression} > 0 THEN 1 ELSE 0 END) as due_bill_count,
        (
          SELECT b2.id
          FROM bills b2
          WHERE b2.tenant_id = b.tenant_id
            AND b2.visit_id = b.visit_id
            AND (b2.status IS NULL OR b2.status NOT IN ('cancelled', 'refunded', 'draft'))
          ORDER BY b2.created_at DESC, b2.id DESC
          LIMIT 1
        ) as latest_bill_id,
        (
          SELECT b2.invoice_no
          FROM bills b2
          WHERE b2.tenant_id = b.tenant_id
            AND b2.visit_id = b.visit_id
            AND (b2.status IS NULL OR b2.status NOT IN ('cancelled', 'refunded', 'draft'))
          ORDER BY b2.created_at DESC, b2.id DESC
          LIMIT 1
        ) as latest_invoice_no
      FROM bills b
      WHERE (b.status IS NULL OR b.status NOT IN ('cancelled', 'refunded', 'draft'))
        AND b.visit_id IS NOT NULL
      GROUP BY b.tenant_id, b.visit_id
    ) bs ON bs.tenant_id = v.tenant_id AND bs.visit_id = v.id
    LEFT JOIN bills lb ON lb.id = bs.latest_bill_id AND lb.tenant_id = v.tenant_id
    LEFT JOIN doctors rd ON rd.id = lb.referring_doctor_id AND rd.tenant_id = v.tenant_id
    WHERE v.tenant_id = ? AND v.visit_date >= ? AND v.visit_date < date(?, '+1 day')
  `;
  const params: (string | number)[] = [tenantId, date, date];

  if (search) {
    const safe = escapeLikeWildcards(search);
    const invoiceTerms = buildInvoiceSearchTerms(safe);
    const like = `%${safe}%`;
    sql += ` AND (
      p.name LIKE ? ESCAPE '\\'
      OR p.patient_code LIKE ? ESCAPE '\\'
      OR p.mobile LIKE ? ESCAPE '\\'
      OR bs.latest_invoice_no LIKE ? ESCAPE '\\'
      OR bs.latest_invoice_no LIKE ? ESCAPE '\\'
      OR bs.latest_invoice_no LIKE ? ESCAPE '\\'
    )`;
    params.push(like, like, like, invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded);
  }

  sql += ` ORDER BY v.created_at DESC LIMIT ?`;
  params.push(limit);

  const { results } = await db.$client.prepare(sql).bind(...params).all<Record<string, unknown>>();
  return c.json({ visits: (results ?? []).filter((visit) => visit.id != null) });
});

// ═══════════════════════════════════════════════════════════════════
// 10. TOKEN RESERVATIONS
// ═══════════════════════════════════════════════════════════════════

receptionRoutes.get('/token-reservations', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const doctorId = c.req.query('doctorId');
  await ensureTokenReservationsTable(c.env.DB);

  // Show reservations that are active on `date`, including range
  // reservations (start..end) and "Always" reservations (end_date = sentinel).
  let query = `
    SELECT tr.*, d.name AS doctor_name
    FROM token_reservations tr
    LEFT JOIN doctors d ON d.id = tr.doctor_id AND d.tenant_id = tr.tenant_id
    WHERE tr.tenant_id = ?
      AND tr.is_active = 1
      AND ? BETWEEN tr.reservation_date AND tr.end_date
  `;
  const params: (string | number)[] = [tenantId, date];

  if (doctorId) {
    query += ' AND tr.doctor_id = ?';
    params.push(Number(doctorId));
  }

  query += ' ORDER BY tr.token_from ASC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ date, reservations: results });
});

receptionRoutes.get('/token-reservations/available', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const doctorId = c.req.query('doctorId');
  await ensureTokenReservationsTable(c.env.DB);

  if (!doctorId) throw new HTTPException(400, { message: 'doctorId is required' });

  const { results: ranges } = await c.env.DB.prepare(`
    SELECT token_from, token_to, label FROM token_reservations
    WHERE tenant_id = ? AND doctor_id = ? AND is_active = 1
      AND ? BETWEEN reservation_date AND end_date
    ORDER BY token_from ASC
  `).bind(tenantId, Number(doctorId), date).all();

  const { results: booked } = await c.env.DB.prepare(`
    SELECT token_no FROM appointments
    WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ?
      AND status NOT IN ('cancelled', 'no_show')
  `).bind(tenantId, date, Number(doctorId)).all<{ token_no: unknown }>();

  const bookedTokens = booked
    .map((row) => Number(row.token_no))
    .filter((tokenNo) => Number.isInteger(tokenNo) && tokenNo > 0);

  const availability = buildTokenReservationAvailability({
    ranges: ranges as Array<{ token_from: number; token_to: number; label?: string | null }>,
    bookedTokenNumbers: bookedTokens,
  });

  return c.json({
    date,
    doctorId: Number(doctorId),
    tokens: availability.tokens,
    available: availability.tokens.map((token) => ({ token: token.token, label: token.label })),
    bookedTokens,
    summary: availability.summary,
  });
});

receptionRoutes.post('/token-reservations', zValidator('json', createTokenReservationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await ensureTokenReservationsTable(c.env.DB);

  const endDate = data.endDate ?? data.reservationDate;
  const newStart = data.reservationDate;
  const newEnd = endDate;

  // Overlap check: existing reservation must overlap the new range on
  // (date) AND (token range) to be considered a conflict.
  const { results: overlapping } = await c.env.DB.prepare(`
    SELECT id, reservation_date, end_date, token_from, token_to FROM token_reservations
    WHERE tenant_id = ? AND is_active = 1
      AND (doctor_id = ? OR (doctor_id IS NULL AND ? IS NULL))
      AND NOT (end_date < ? OR reservation_date > ?)
      AND NOT (token_to < ? OR token_from > ?)
  `).bind(
    tenantId,
    data.doctorId ?? null, data.doctorId ?? null,
    newStart, newEnd,
    data.tokenFrom, data.tokenTo
  ).all();

  if (overlapping.length > 0) {
    const first = overlapping[0] as any;
    throw new HTTPException(409, {
      message: `Overlaps with existing reservation (tokens ${first.token_from}-${first.token_to}, ${first.reservation_date}${first.reservation_date === first.end_date ? '' : ` → ${first.end_date}`})`,
    });
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO token_reservations (tenant_id, doctor_id, reservation_date, end_date, token_from, token_to, label, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.doctorId ?? null, newStart, newEnd,
    data.tokenFrom, data.tokenTo, data.label ?? null, userId
  ).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'token_reservations', result.meta.last_row_id, null, data);

  return c.json({ id: result.meta.last_row_id, ...data, endDate: newEnd }, 201);
});

receptionRoutes.patch('/token-reservations/:id', zValidator('json', updateTokenReservationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  await ensureTokenReservationsTable(c.env.DB);

  const existing = await c.env.DB.prepare(`
    SELECT * FROM token_reservations WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Reservation not found' });

  const tokenFrom = data.tokenFrom ?? (existing as any).token_from;
  const tokenTo = data.tokenTo ?? (existing as any).token_to;
  const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : (existing as any).is_active;
  const label = data.label !== undefined ? data.label : (existing as any).label;

  await c.env.DB.prepare(`
    UPDATE token_reservations
    SET token_from = ?, token_to = ?, label = ?, is_active = ?, updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(tokenFrom, tokenTo, label, isActive, id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'token_reservations', id, existing, data);

  return c.json({ id, tokenFrom, tokenTo, label, isActive: Boolean(isActive) });
});

receptionRoutes.delete('/token-reservations/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  await ensureTokenReservationsTable(c.env.DB);

  const existing = await c.env.DB.prepare(`
    SELECT * FROM token_reservations WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first();

  if (!existing) throw new HTTPException(404, { message: 'Reservation not found' });

  await c.env.DB.prepare('DELETE FROM token_reservations WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'DELETE', 'token_reservations', id, existing, null);

  return c.json({ deleted: true });
});

// ── Print audit (soft log) ───────────────────────────────────────────────
// Reception single-document prints log a row to audit_logs for traceability.
// Endpoint is mounted at POST /api/reception/print-audit and accepts a JSON
// body from the frontend's `receptionPrint` module after window.print() fires.
// This is a best-effort log; failures must not block the user.

const printAuditSchema = z.object({
  documentType: z.string().min(1).max(64),
  documentId: z.union([z.string(), z.number()]),
  copyNumber: z.number().int().min(1).max(99).optional(),
  watermark: z.string().max(32).nullish(),
  generatedAt: z.string().optional(),
});

receptionRoutes.post('/print-audit', zValidator('json', printAuditSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = c.req.valid('json');

  try {
    const { recordPrint, getRequestMeta } = await import('../../lib/print-audit');
    await recordPrint({
      env: c.env,
      tenantId,
      userId: Number(userId),
      documentType: body.documentType,
      documentId: body.documentId,
      copyNumber: body.copyNumber ?? 1,
      watermark: body.watermark ?? null,
      ...getRequestMeta(c),
    });
  } catch (error) {
    // Best-effort: do not throw — print should still succeed for the user.
    console.error('print-audit failed', error);
  }

  return c.json({ logged: true });
});

export default receptionRoutes;

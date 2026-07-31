import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { determineAbnormalFlag as determineAbnormalFromRange } from '../../lib/lab-formula-evaluator';
import { assertLabReportNotRetracted } from '../../lib/lis-retraction-guards';
import {
  assertLabBillingCleared,
  buildLabSampleBarcode,
  calculateLabTatMinutes,
  isLabDelayed,
  isLabStatusTransitionAllowed,
  recordLabWorkflowEvent,
  resolveLabScanCode,
} from '../../lib/lab-workflow';

const labWorkflowRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const LAB_ACCESS_ROLES = [
  'laboratory',
  'lab',
  'lab_tech',
  'doctor',
  'md',
  'nurse',
  'reception',
  'receptionist',
  'hospital_admin',
  'director',
  'accountant',
] as const;

labWorkflowRoutes.use('*', requireRole(...LAB_ACCESS_ROLES));

// ─── P0-14: pathologist / supervisor only for report governance ──────────
import {
  LAB_REPORT_GOVERNANCE_ROLES,
  LAB_RESULT_ENTRY_ROLES,
  LAB_SAMPLE_COLLECT_ROLES,
  LAB_QC_RELEASE_ROLES,
} from './lab/_permissions';

const dashboardQuerySchema = z.object({
  department: z.string().trim().optional(),
  department_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(5).max(100).default(12),
});

const worklistQuerySchema = z.object({
  stage: z.enum(['collection', 'receiving', 'result_entry', 'verification', 'validation', 'delivery', 'critical', 'rejected', 'delayed']).default('collection'),
  department: z.string().trim().optional(),
  department_id: z.coerce.number().int().positive().optional(),
  search: z.string().trim().optional(),
  priority: z.enum(['routine', 'urgent', 'stat', 'asap']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const scanSchema = z.object({
  code: z.string().trim().min(1, 'Scan code required'),
});

const collectSchema = z.object({
  notes: z.string().trim().optional(),
  specimen_type: z.string().trim().optional(),
  sample_container: z.string().trim().optional(),
  department_id: z.coerce.number().int().positive().optional(),
});

const receiveSchema = z.object({
  notes: z.string().trim().optional(),
});

const sampleStorageSchema = z.object({
  fridge: z.string().trim().max(80).optional(),
  rack: z.string().trim().max(80).optional(),
  box: z.string().trim().max(80).optional(),
  position: z.string().trim().max(80).optional(),
  storage_condition: z.string().trim().max(120).optional(),
  notes: z.string().trim().optional(),
}).refine((data) => data.fridge || data.rack || data.box || data.position || data.storage_condition, {
  message: 'At least one storage field is required',
});

const sampleReferralSchema = z.object({
  referral_lab_name: z.string().trim().min(1, 'Referral lab name required').max(200),
  referral_contact: z.string().trim().max(120).optional(),
  referral_tracking_no: z.string().trim().max(120).optional(),
  referral_reason: z.string().trim().max(500).optional(),
  expected_return_at: z.string().trim().max(80).optional(),
  notes: z.string().trim().optional(),
});

const reviewSchema = z.object({
  notes: z.string().trim().optional(),
});

const validateSchema = z.object({
  notes: z.string().trim().optional(),
  signatory_ids: z.array(z.number().int().positive()).optional(),
});

const deliverSchema = z.object({
  delivery_method: z.enum(['print', 'sms', 'email', 'portal', 'whatsapp', 'handover']).default('print'),
  recipient_name: z.string().trim().optional(),
  recipient_contact: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  copy_count: z.number().int().min(1).max(10).default(1),
});

const acknowledgeSchema = z.object({
  acknowledged_to: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const correctionSchema = z.object({
  reason: z.string().trim().min(1, 'Correction reason required'),
  notes: z.string().trim().optional(),
  results: z.array(z.object({
    result_id: z.number().int().positive(),
    result_value: z.string().trim().min(1, 'Result value required'),
    comments: z.string().trim().optional(),
  })).min(1, 'At least one corrected result is required'),
});

const createDepartmentSchema = z.object({
  department_code: z.string().trim().min(1, 'Department code required').max(50),
  department_name: z.string().trim().min(1, 'Department name required').max(200),
  queue_prefix: z.string().trim().max(10).optional(),
  report_header: z.string().trim().optional(),
  report_footer: z.string().trim().optional(),
  tat_target_minutes: z.coerce.number().int().positive().optional(),
});

const updateDepartmentSchema = z.object({
  department_name: z.string().trim().min(1).max(200).optional(),
  queue_prefix: z.string().trim().max(10).optional(),
  report_header: z.string().trim().optional(),
  report_footer: z.string().trim().optional(),
  tat_target_minutes: z.coerce.number().int().positive().optional(),
  is_active: z.coerce.number().int().min(0).max(1).optional(),
});

const assignDepartmentUserSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  workflow_role: z.enum(['lab_technician', 'phlebotomist', 'pathologist', 'supervisor', 'admin']).default('lab_technician'),
  can_collect: z.coerce.number().int().min(0).max(1).default(0),
  can_receive: z.coerce.number().int().min(0).max(1).default(0),
  can_deliver: z.coerce.number().int().min(0).max(1).default(0),
  can_verify: z.coerce.number().int().min(0).max(1).default(0),
  can_validate: z.coerce.number().int().min(0).max(1).default(0),
});

function toNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function workflowNow(): string {
  return "datetime('now', '+6 hours')";
}

function labDepartmentJoin(): string {
  return `
    LEFT JOIN lab_departments ld
      ON ld.tenant_id = lo.tenant_id
     AND (
       ld.id = loi.department_id
       OR (
         loi.department_id IS NULL
         AND ld.department_code = UPPER(REPLACE(TRIM(COALESCE(NULLIF(ltc.department, ''), ltc.category, 'GENERAL')), ' ', '_'))
       )
     )
  `;
}

function labWorkflowBillingJoin(): string {
  return `
    LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = lo.tenant_id
    LEFT JOIN invoice_items lab_item_invoice
      ON lab_item_invoice.tenant_id = lo.tenant_id
     AND lab_item_invoice.reference_id = loi.id
     AND lab_item_invoice.item_category = 'test'
     AND COALESCE(lab_item_invoice.status, 'active') = 'active'
    LEFT JOIN bills lab_item_bill
      ON lab_item_bill.id = lab_item_invoice.bill_id
     AND lab_item_bill.tenant_id = lo.tenant_id
     AND COALESCE(lab_item_bill.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
  `;
}

function labWorkflowBillingColumns(): string {
  return `
      CASE WHEN lo.prescription_id IS NOT NULL THEN lab_item_bill.id ELSE b.id END AS bill_id,
      CASE
        WHEN lo.prescription_id IS NOT NULL AND lab_item_bill.id IS NULL THEN 'pending_selection'
        WHEN lo.prescription_id IS NOT NULL
          AND COALESCE(lab_item_bill.status, 'open') IN ('open', 'partially_paid')
          AND COALESCE(lab_item_bill.paid, 0) < COALESCE(lab_item_bill.total, 0)
          THEN 'approved_credit'
        WHEN lo.prescription_id IS NOT NULL THEN COALESCE(lo.billing_status, 'paid')
        ELSE lo.billing_status
      END AS diagnostic_billing_status,
      CASE WHEN lo.prescription_id IS NOT NULL THEN lab_item_bill.status ELSE b.status END AS bill_status,
      CASE WHEN lo.prescription_id IS NOT NULL THEN lab_item_bill.total ELSE b.total END AS bill_total,
      CASE WHEN lo.prescription_id IS NOT NULL THEN lab_item_bill.paid ELSE b.paid END AS bill_paid
  `;
}

function prescriptionLabItemApprovalClause(): string {
  return ' AND (lo.prescription_id IS NULL OR lab_item_bill.id IS NOT NULL) ';
}

function parseMetadataJson(value: unknown): unknown {
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
}

function ageMonthsFromDateOfBirth(dateOfBirth: unknown): number {
  if (!dateOfBirth) return 0;
  const dob = new Date(String(dateOfBirth));
  if (Number.isNaN(dob.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
}

function detectAbnormalFlag(
  numericValue: number | null,
  normalRange: string | null | undefined,
  criticalLow?: number | null,
  criticalHigh?: number | null,
): 'normal' | 'high' | 'low' | 'critical' | 'pending' {
  if (numericValue === null || !normalRange) return 'pending';

  const rangeStr = normalRange.includes('|')
    ? normalRange.split('|')[0].replace(/^[MF]:/, '')
    : normalRange;
  const match = rangeStr.match(/^([\d.]+)-([\d.]+)$/);
  if (!match) return 'pending';

  const low = Number.parseFloat(match[1]);
  const high = Number.parseFloat(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 'pending';

  const cLow = criticalLow !== null && criticalLow !== undefined ? Number(criticalLow) : low - (high - low);
  const cHigh = criticalHigh !== null && criticalHigh !== undefined ? Number(criticalHigh) : high + (high - low);

  if (numericValue < cLow || numericValue > cHigh) return 'critical';
  if (numericValue < low) return 'low';
  if (numericValue > high) return 'high';
  return 'normal';
}

function combineAbnormalFlags(flags: unknown[]): string {
  const priority = ['critical', 'high', 'low', 'normal', 'pending'];
  const normalized = flags.map((flag) => String(flag ?? 'pending'));
  return priority.find((flag) => normalized.includes(flag)) ?? 'pending';
}

async function getStructuredReferenceRange(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  testId: number,
  componentId: number | null,
  patientGender: string | null,
  patientAgeMonths: number,
): Promise<{ range_low: number | null; range_high: number | null; critical_low: number | null; critical_high: number | null } | null> {
  const gender = String(patientGender ?? 'both').toLowerCase();
  const genderFilter = gender.startsWith('m') ? 'male' : gender.startsWith('f') ? 'female' : 'both';

  const row = await db.$client.prepare(`
    SELECT range_low, range_high, critical_low, critical_high
    FROM lab_reference_ranges
    WHERE tenant_id = ? AND lab_test_id = ? AND is_active = 1
      AND (component_id = ? OR (component_id IS NULL AND ? IS NULL))
      AND (gender = ? OR gender = 'both')
      AND age_min_months <= ?
      AND (age_max_months IS NULL OR age_max_months >= ?)
    ORDER BY
      CASE WHEN gender = ? THEN 0 ELSE 1 END,
      age_max_months ASC NULLS LAST
    LIMIT 1
  `).bind(tenantId, testId, componentId, componentId, genderFilter, patientAgeMonths, patientAgeMonths, genderFilter).first<{
    range_low: number | null;
    range_high: number | null;
    critical_low: number | null;
    critical_high: number | null;
  }>();

  return row ?? null;
}

async function calculateCorrectedAbnormalFlag(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  resultRow: Record<string, unknown>,
  numericValue: number | null,
): Promise<string> {
  if (numericValue === null) return 'pending';

  const structuredRange = await getStructuredReferenceRange(
    db,
    tenantId,
    toNumber(resultRow.lab_test_id),
    resultRow.component_id === null || resultRow.component_id === undefined ? null : toNumber(resultRow.component_id),
    String(resultRow.gender ?? 'both'),
    ageMonthsFromDateOfBirth(resultRow.date_of_birth),
  );

  if (structuredRange?.range_low !== null && structuredRange?.range_low !== undefined
    && structuredRange.range_high !== null && structuredRange.range_high !== undefined) {
    return determineAbnormalFromRange(
      numericValue,
      structuredRange.range_low,
      structuredRange.range_high,
      structuredRange.critical_low,
      structuredRange.critical_high,
    );
  }

  return detectAbnormalFlag(
    numericValue,
    String(resultRow.normal_range ?? '') || null,
    resultRow.critical_low === null || resultRow.critical_low === undefined ? null : Number(resultRow.critical_low),
    resultRow.critical_high === null || resultRow.critical_high === undefined ? null : Number(resultRow.critical_high),
  );
}

async function refreshOrderItemAbnormalFlag(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  reportId: number,
  orderId: number,
  testId: number,
): Promise<string> {
  const resultFlags = await db.$client.prepare(`
    SELECT abnormal_flag
    FROM lab_results
    WHERE lab_report_id = ? AND lab_test_id = ? AND tenant_id = ?
  `).bind(reportId, testId, tenantId).all<Record<string, unknown>>();

  const combinedFlag = combineAbnormalFlags((resultFlags.results ?? []).map((row) => row.abnormal_flag));

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET abnormal_flag = ?,
        result_status = 'corrected',
        status = CASE WHEN status = 'verified' THEN 'completed' ELSE status END,
        updated_at = ${workflowNow()}
    WHERE lab_order_id = ? AND tenant_id = ? AND lab_test_id = ?
  `).bind(combinedFlag, orderId, tenantId, testId).run();

  return combinedFlag;
}

function nextActionForRow(row: Record<string, unknown>): string {
  const status = String(row.status ?? 'pending');
  const reviewStatus = String(row.review_status ?? 'pending');
  const reportStatus = String(row.report_status ?? 'pending');
  const deliveryStatus = String(row.delivery_status ?? 'pending');

  if (status === 'pending') return 'collect';
  if (status === 'collected') return 'receive';
  if (status === 'received' || status === 'processing') return 'enter_result';
  if (status === 'completed' && reviewStatus !== 'verified' && reportStatus !== 'published') return 'verify';
  if ((reviewStatus === 'verified' || status === 'verified') && reportStatus !== 'published') return 'validate';
  if (reportStatus === 'published' && deliveryStatus !== 'delivered') return 'deliver';
  return 'view';
}

function departmentClause(
  departmentId: number | undefined,
  department: string | undefined,
  params: Array<string | number>,
): string {
  if (departmentId) {
    params.push(departmentId, departmentId);
    return " AND (loi.department_id = ? OR (loi.department_id IS NULL AND ld.id = ?)) ";
  }
  if (!department) return '';
  params.push(department);
  return " AND COALESCE(ld.department_name, NULLIF(ltc.department, ''), ltc.category, 'General') = ? ";
}

function searchClause(search: string | undefined, params: Array<string | number>): string {
  if (!search) return '';
  const term = `%${search}%`;
  params.push(term, term, term, term, term);
  return `
    AND (
      p.name LIKE ?
      OR p.patient_code LIKE ?
      OR p.mobile LIKE ?
      OR lo.order_no LIKE ?
      OR COALESCE(loi.barcode, '') LIKE ?
    )
  `;
}

function priorityClause(priority: string | undefined, params: Array<string | number>): string {
  if (!priority) return '';
  params.push(priority);
  return ' AND lo.priority = ? ';
}

async function fetchWorklist(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  stage: z.infer<typeof worklistQuerySchema>['stage'],
  departmentId: number | undefined,
  department: string | undefined,
  search: string | undefined,
  priority: string | undefined,
  limit: number,
) {
  const params: Array<string | number> = [tenantId];
  let stageWhere = "loi.status = 'pending'";

  switch (stage) {
    case 'collection':
      stageWhere = "loi.status = 'pending'";
      break;
    case 'receiving':
      stageWhere = "loi.status = 'collected'";
      break;
    case 'result_entry':
      stageWhere = "loi.status IN ('received', 'processing')";
      break;
    case 'verification':
      stageWhere = "loi.status = 'completed' AND COALESCE(lrp.review_status, 'pending') = 'pending'";
      break;
    case 'validation':
      stageWhere = "COALESCE(lrp.review_status, 'pending') = 'verified' AND COALESCE(lrp.report_status, 'pending') != 'published'";
      break;
    case 'delivery':
      stageWhere = "COALESCE(lrp.report_status, 'pending') = 'published' AND COALESCE(lrp.delivery_status, 'pending') != 'delivered'";
      break;
    case 'critical':
      stageWhere = "loi.abnormal_flag = 'critical' AND loi.status IN ('completed', 'verified')";
      break;
    case 'rejected':
      stageWhere = "loi.status = 'rejected'";
      break;
    case 'delayed':
      stageWhere = "COALESCE(ltc.tat_minutes, 0) > 0 AND loi.status NOT IN ('verified', 'cancelled') AND (julianday('now', '+6 hours') - julianday(lo.created_at)) * 24 * 60 > ltc.tat_minutes";
      break;
  }

  const query = `
    SELECT
      loi.id AS item_id,
      loi.lab_order_id AS order_id,
      loi.lab_test_id,
      loi.status,
      loi.sample_status,
      loi.result_status,
      CASE WHEN loi.result_status = 'draft' THEN 1 ELSE 0 END AS is_draft,
      loi.result,
      loi.result_numeric,
      loi.abnormal_flag,
      loi.barcode,
      loi.specimen_num,
      loi.collected_at,
      loi.received_at,
      loi.completed_at,
      loi.verified_at,
      loi.notes,
      lo.order_no,
      lo.order_date,
      lo.created_at AS ordered_at,
      lo.priority,
      lo.visit_id,
      ${labWorkflowBillingColumns()},
      p.id AS patient_id,
      p.name AS patient_name,
      p.patient_code,
      p.mobile,
      p.gender,
      CAST((julianday('now') - julianday(p.date_of_birth)) / 365.25 AS INTEGER) AS patient_age,
      ltc.name AS test_name,
      ltc.code AS test_code,
      ltc.unit,
      ltc.normal_range AS reference_range,
      ltc.tat_minutes AS target_tat,
      ltc.value_type,
      ld.id AS department_id,
      COALESCE(ld.department_name, NULLIF(ltc.department, ''), ltc.category, 'General') AS department_name,
      COALESCE(loi.specimen_type, lo.specimen_type, ltc.specimen_type) AS sample_type,
      COALESCE(loi.sample_container, ltc.specimen_container) AS container_type,
      lrp.id AS report_id,
      lrp.review_status,
      lrp.report_status,
      lrp.delivery_status,
      lrp.validated_at,
      lrp.delivered_at,
      (
        SELECT lr.id
        FROM lab_results lr
        WHERE lr.lab_report_id = lrp.id AND lr.lab_test_id = loi.lab_test_id
        ORDER BY lr.id DESC
        LIMIT 1
      ) AS result_id,
      (
        SELECT lr.previous_value
        FROM lab_results lr
        WHERE lr.lab_report_id = lrp.id AND lr.lab_test_id = loi.lab_test_id
        ORDER BY lr.id DESC
        LIMIT 1
      ) AS previous_result,
      (
        SELECT COUNT(*)
        FROM lab_critical_acknowledgements lca
        WHERE lca.lab_order_item_id = loi.id AND lca.tenant_id = lo.tenant_id
      ) AS critical_ack_count
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    ${labWorkflowBillingJoin()}
    JOIN patients p ON lo.patient_id = p.id
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    ${labDepartmentJoin()}
    LEFT JOIN lab_reports lrp ON lrp.lab_order_id = lo.id
    WHERE lo.tenant_id = ?
      AND ${stageWhere}
      ${prescriptionLabItemApprovalClause()}
      ${departmentClause(departmentId, department, params)}
      ${searchClause(search, params)}
      ${priorityClause(priority, params)}
    ORDER BY
      CASE lo.priority WHEN 'stat' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
      lo.created_at ASC,
      loi.id ASC
    LIMIT ?
  `;

  params.push(limit);
  const result = await db.$client.prepare(query).bind(...params).all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => {
    const tatMinutes = calculateLabTatMinutes(String(row.ordered_at ?? null), String(row.completed_at ?? null));
    const targetTat = toNumber(row.target_tat);
    return {
      ...row,
      tat_minutes: tatMinutes,
      is_delayed: isLabDelayed(String(row.ordered_at ?? null), targetTat || null, String(row.completed_at ?? null)),
      next_action: stage === 'critical' ? 'acknowledge' : nextActionForRow(row),
    };
  });
}

labWorkflowRoutes.get('/dashboard', zValidator('query', dashboardQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { department, department_id: departmentId, limit } = c.req.valid('query');
  const today = getTodayGMT6();
  const summaryParams: Array<string | number> = [tenantId, today];
  const summaryDepartmentFilter = departmentClause(departmentId, department, summaryParams);

  const [summary, reagent, worklistResults] = await Promise.all([
    db.$client.prepare(`
      SELECT
        COUNT(loi.id) AS total_orders,
        SUM(CASE WHEN loi.status = 'pending' THEN 1 ELSE 0 END) AS pending_sample_collection,
        SUM(CASE WHEN loi.status = 'collected' THEN 1 ELSE 0 END) AS sample_collected,
        SUM(CASE WHEN loi.status = 'processing' THEN 1 ELSE 0 END) AS in_progress_tests,
        SUM(CASE WHEN loi.status IN ('received', 'processing') THEN 1 ELSE 0 END) AS pending_result_entry,
        SUM(CASE WHEN COALESCE(lrp.review_status, 'pending') = 'verified' AND COALESCE(lrp.report_status, 'pending') != 'published' THEN 1 ELSE 0 END) AS pending_validation,
        COUNT(DISTINCT CASE WHEN COALESCE(lrp.report_status, 'pending') = 'published' THEN lrp.id END) AS completed_reports,
        COUNT(DISTINCT CASE WHEN COALESCE(lrp.delivery_status, 'pending') = 'delivered' THEN lrp.id END) AS delivered_reports,
        SUM(CASE WHEN loi.abnormal_flag = 'critical' AND loi.status IN ('completed', 'verified') THEN 1 ELSE 0 END) AS critical_results,
        SUM(CASE WHEN loi.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_samples,
        SUM(CASE WHEN loi.machine_id IS NOT NULL AND loi.status IN ('received', 'processing') THEN 1 ELSE 0 END) AS machine_pending_tests,
        AVG(
          CASE
            WHEN loi.completed_at IS NOT NULL THEN (julianday(loi.completed_at) - julianday(lo.created_at)) * 24 * 60
            ELSE NULL
          END
        ) AS avg_tat_minutes,
        SUM(
          CASE
            WHEN COALESCE(ltc.tat_minutes, 0) > 0
              AND loi.status NOT IN ('verified', 'cancelled')
              AND (julianday('now', '+6 hours') - julianday(lo.created_at)) * 24 * 60 > ltc.tat_minutes
            THEN 1 ELSE 0
          END
        ) AS delayed_reports
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      ${labWorkflowBillingJoin()}
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      ${labDepartmentJoin()}
      LEFT JOIN lab_reports lrp ON lrp.lab_order_id = lo.id
      WHERE lo.tenant_id = ?
        AND lo.order_date = ?
        ${prescriptionLabItemApprovalClause()}
        ${summaryDepartmentFilter}
    `).bind(...summaryParams).first<Record<string, unknown>>(),

    db.$client.prepare(`
      SELECT COUNT(*) AS low_alerts
      FROM (
        SELECT c.id
        FROM lab_consumables c
        LEFT JOIN lab_consumable_stock s
          ON s.consumable_id = c.id
          AND s.quantity_available > 0
        WHERE c.tenant_id = ?
          AND c.is_active = 1
        GROUP BY c.id, c.reorder_level
        HAVING COALESCE(SUM(s.quantity_available), 0) <= COALESCE(c.reorder_level, 0)
      ) low_stock
    `).bind(tenantId).first<Record<string, unknown>>(),

    Promise.all([
      fetchWorklist(db, tenantId, 'collection', departmentId, department, undefined, undefined, limit),
      fetchWorklist(db, tenantId, 'result_entry', departmentId, department, undefined, undefined, limit),
      fetchWorklist(db, tenantId, 'verification', departmentId, department, undefined, undefined, limit),
      fetchWorklist(db, tenantId, 'critical', departmentId, department, undefined, undefined, limit),
      fetchWorklist(db, tenantId, 'rejected', departmentId, department, undefined, undefined, limit),
      fetchWorklist(db, tenantId, 'delayed', departmentId, department, undefined, undefined, limit),
    ]),
  ]);

  const [
    pendingSampleCollection,
    pendingResultEntry,
    pendingApproval,
    criticalAlerts,
    rejectedSamples,
    delayedTat,
  ] = worklistResults;

  return c.json({
    generated_at: new Date().toISOString(),
    summary: {
      today_total_lab_orders: toNumber(summary?.total_orders),
      pending_sample_collection: toNumber(summary?.pending_sample_collection),
      sample_collected: toNumber(summary?.sample_collected),
      in_progress_tests: toNumber(summary?.in_progress_tests),
      pending_result_entry: toNumber(summary?.pending_result_entry),
      pending_validation: toNumber(summary?.pending_validation),
      completed_reports: toNumber(summary?.completed_reports),
      delivered_reports: toNumber(summary?.delivered_reports),
      critical_results: toNumber(summary?.critical_results),
      rejected_samples: toNumber(summary?.rejected_samples),
      delayed_reports: toNumber(summary?.delayed_reports),
      machine_pending_tests: toNumber(summary?.machine_pending_tests),
      reagent_low_alerts: toNumber(reagent?.low_alerts),
      average_turnaround_time_minutes: Math.round(toNumber(summary?.avg_tat_minutes)),
    },
    actions: {
      pending_sample_collection: pendingSampleCollection,
      pending_result_entry: pendingResultEntry,
      pending_approval: pendingApproval,
      critical_value_alerts: criticalAlerts,
      rejected_samples: rejectedSamples,
      delayed_tat: delayedTat,
    },
  });
});

labWorkflowRoutes.get('/worklists', zValidator('query', worklistQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { stage, department, department_id: departmentId, search, priority, limit } = c.req.valid('query');
  const items = await fetchWorklist(db, tenantId, stage, departmentId, department, search, priority, limit);
  return c.json({ stage, items });
});

labWorkflowRoutes.get('/items/:itemId/timeline', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const itemId = Number(c.req.param('itemId'));

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, lo.patient_id, lrp.id AS report_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id
    LEFT JOIN lab_reports lrp ON lrp.lab_order_id = lo.id
    WHERE loi.id = ? AND lo.tenant_id = ?
    LIMIT 1
  `).bind(itemId, tenantId).first<Record<string, unknown>>();

  if (!item) {
    throw new HTTPException(404, { message: 'Lab order item not found' });
  }

  const timeline = await db.$client.prepare(`
    SELECT id, event_type, event_stage, lab_order_id, lab_order_item_id, lab_report_id,
           patient_id, from_status, to_status, actor_user_id, actor_role, notes,
           metadata_json, created_at
    FROM lab_workflow_events
    WHERE tenant_id = ?
      AND (
        lab_order_item_id = ?
        OR (lab_order_item_id IS NULL AND lab_order_id = ?)
        OR (? IS NOT NULL AND lab_report_id = ?)
      )
    ORDER BY created_at ASC, id ASC
  `).bind(
    tenantId,
    itemId,
    item.lab_order_id,
    item.report_id ?? null,
    item.report_id ?? null,
  ).all<Record<string, unknown>>();

  return c.json({
    item_id: itemId,
    order_id: item.lab_order_id,
    report_id: item.report_id ?? null,
    events: (timeline.results ?? []).map((event) => ({
      ...event,
      metadata: parseMetadataJson(event.metadata_json),
      metadata_json: undefined,
    })),
  });
});

labWorkflowRoutes.get('/reports/:reportId/history', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const reportId = Number(c.req.param('reportId'));

  const report = await db.$client.prepare(`
    SELECT lr.id, lr.lab_order_id, lo.patient_id
    FROM lab_reports lr
    JOIN lab_orders lo ON lo.id = lr.lab_order_id
    WHERE lr.id = ? AND lr.tenant_id = ?
  `).bind(reportId, tenantId).first<Record<string, unknown>>();

  if (!report) {
    throw new HTTPException(404, { message: 'Lab report not found' });
  }

  const history = await db.$client.prepare(`
    SELECT id, event_type, event_stage, lab_order_id, lab_order_item_id, lab_report_id,
           patient_id, from_status, to_status, actor_user_id, actor_role, notes,
           metadata_json, created_at
    FROM lab_workflow_events
    WHERE tenant_id = ?
      AND (lab_report_id = ? OR (lab_report_id IS NULL AND lab_order_id = ?))
    ORDER BY created_at ASC, id ASC
  `).bind(tenantId, reportId, report.lab_order_id).all<Record<string, unknown>>();

  return c.json({
    report_id: reportId,
    order_id: report.lab_order_id,
    events: (history.results ?? []).map((event) => ({
      ...event,
      metadata: parseMetadataJson(event.metadata_json),
      metadata_json: undefined,
    })),
  });
});

labWorkflowRoutes.post('/scan/resolve', zValidator('json', scanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { code } = c.req.valid('json');
  const resolution = resolveLabScanCode(code);

  if (resolution.entityType === 'unknown') {
    throw new HTTPException(404, { message: 'Scan code not recognized' });
  }

  let row: Record<string, unknown> | null = null;

  if (resolution.entityType === 'order' && resolution.orderNo) {
    row = await db.$client.prepare(`
      SELECT loi.id AS item_id, loi.lab_order_id AS order_id, loi.status, loi.barcode,
             lo.order_no, p.name AS patient_name, ltc.name AS test_name,
             lrp.id AS report_id, lrp.review_status, lrp.report_status, lrp.delivery_status
      FROM lab_orders lo
      JOIN lab_order_items loi ON loi.lab_order_id = lo.id
      JOIN patients p ON p.id = lo.patient_id
      JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
      LEFT JOIN lab_reports lrp ON lrp.lab_order_id = lo.id
      WHERE lo.tenant_id = ? AND lo.order_no = ?
      ORDER BY
        CASE loi.status WHEN 'pending' THEN 0 WHEN 'collected' THEN 1 WHEN 'received' THEN 2 WHEN 'processing' THEN 3 WHEN 'completed' THEN 4 ELSE 5 END,
        loi.id ASC
      LIMIT 1
    `).bind(tenantId, resolution.orderNo).first<Record<string, unknown>>();
  } else if (resolution.entityType === 'sample' && resolution.sampleBarcode) {
    row = await db.$client.prepare(`
      SELECT loi.id AS item_id, loi.lab_order_id AS order_id, loi.status, loi.barcode,
             lo.order_no, p.name AS patient_name, ltc.name AS test_name,
             lrp.id AS report_id, lrp.review_status, lrp.report_status, lrp.delivery_status
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      JOIN patients p ON p.id = lo.patient_id
      JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
      LEFT JOIN lab_reports lrp ON lrp.lab_order_id = lo.id
      WHERE lo.tenant_id = ? AND (loi.barcode = ? OR loi.id = ?)
      LIMIT 1
    `).bind(tenantId, resolution.sampleBarcode, resolution.itemId ?? 0).first<Record<string, unknown>>();
  } else if (resolution.entityType === 'item' && resolution.itemId) {
    row = await db.$client.prepare(`
      SELECT loi.id AS item_id, loi.lab_order_id AS order_id, loi.status, loi.barcode,
             lo.order_no, p.name AS patient_name, ltc.name AS test_name,
             lrp.id AS report_id, lrp.review_status, lrp.report_status, lrp.delivery_status
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      JOIN patients p ON p.id = lo.patient_id
      JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
      LEFT JOIN lab_reports lrp ON lrp.lab_order_id = lo.id
      WHERE lo.tenant_id = ? AND loi.id = ?
      LIMIT 1
    `).bind(tenantId, resolution.itemId).first<Record<string, unknown>>();
  }

  if (!row) {
    throw new HTTPException(404, { message: 'No lab record matched the scanned code' });
  }

  return c.json({
    resolution,
    record: row,
    next_action: nextActionForRow(row),
  });
});

labWorkflowRoutes.post('/items/:itemId/collect', zValidator('json', collectSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, loi.lab_test_id, loi.status, loi.barcode, loi.specimen_num, loi.specimen_type,
           loi.department_id,
           loi.sample_container, lo.patient_id, lo.order_no, ${labWorkflowBillingColumns()},
           ltc.specimen_type AS default_specimen_type, ltc.specimen_container AS default_container,
           ld.id AS default_department_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    ${labWorkflowBillingJoin()}
    JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id
    ${labDepartmentJoin()}
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first<Record<string, unknown>>();

  if (!item) {
    throw new HTTPException(404, { message: 'Lab order item not found' });
  }

  try {
    assertLabBillingCleared(item, 'sample collection');
  } catch (error) {
    throw new HTTPException(409, { message: error instanceof Error ? error.message : 'Billing clearance required' });
  }

  if (!isLabStatusTransitionAllowed(String(item.status ?? 'pending'), 'collected')) {
    throw new HTTPException(400, { message: `Cannot collect sample from status '${item.status}'` });
  }

  const barcode = String(item.barcode ?? '') || buildLabSampleBarcode(itemId);
  const specimenNum = String(item.specimen_num ?? '') || `SMP-${String(itemId).padStart(6, '0')}`;
  const specimenType = data.specimen_type ?? String(item.specimen_type ?? item.default_specimen_type ?? '');
  const sampleContainer = data.sample_container ?? String(item.sample_container ?? item.default_container ?? '');
  let departmentId = data.department_id ?? (item.department_id ? toNumber(item.department_id) : null) ?? (item.default_department_id ? toNumber(item.default_department_id) : null);

  if (data.department_id) {
    const department = await db.$client.prepare(`
      SELECT id
      FROM lab_departments
      WHERE id = ? AND tenant_id = ? AND is_active = 1
      LIMIT 1
    `).bind(data.department_id, tenantId).first<{ id: number }>();
    if (!department) {
      throw new HTTPException(400, { message: 'Invalid lab department for this tenant' });
    }
    departmentId = department.id;
  }

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET status = 'collected',
        sample_status = 'collected',
        collected_at = ${workflowNow()},
        barcode = ?,
        specimen_num = ?,
        specimen_type = ?,
        sample_container = ?,
        department_id = ?,
        notes = COALESCE(?, notes),
        updated_at = ${workflowNow()}
    WHERE id = ? AND tenant_id = ?
  `).bind(
    barcode,
    specimenNum,
    specimenType || null,
    sampleContainer || null,
    departmentId ?? null,
    data.notes ?? null,
    itemId,
    tenantId,
  ).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'sample_collected',
    eventStage: 'collection',
    labOrderId: toNumber(item.lab_order_id),
    labOrderItemId: itemId,
    patientId: toNumber(item.patient_id),
    fromStatus: String(item.status ?? 'pending'),
    toStatus: 'collected',
    notes: data.notes ?? null,
    metadata: { barcode, specimenNum, specimenType, sampleContainer, departmentId },
  });

  await createAuditLog(c.env, tenantId, userId, 'COLLECT', 'lab_order_items', itemId, item, {
    status: 'collected',
    barcode,
    specimen_num: specimenNum,
    specimen_type: specimenType,
    sample_container: sampleContainer,
    department_id: departmentId ?? null,
  });

  return c.json({
    message: 'Sample collected',
    item_id: itemId,
    barcode,
    specimen_num: specimenNum,
  });
});

labWorkflowRoutes.post('/items/:itemId/receive', zValidator('json', receiveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, loi.lab_test_id, loi.status, lo.patient_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first<Record<string, unknown>>();

  if (!item) {
    throw new HTTPException(404, { message: 'Lab order item not found' });
  }

  if (!isLabStatusTransitionAllowed(String(item.status ?? 'pending'), 'received')) {
    throw new HTTPException(400, { message: `Cannot receive sample from status '${item.status}'` });
  }

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET status = 'received',
        sample_status = 'received_in_lab',
        received_at = ${workflowNow()},
        received_by = ?,
        notes = COALESCE(?, notes),
        updated_at = ${workflowNow()}
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, data.notes ?? null, itemId, tenantId).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'sample_received',
    eventStage: 'receiving',
    labOrderId: toNumber(item.lab_order_id),
    labOrderItemId: itemId,
    patientId: toNumber(item.patient_id),
    fromStatus: String(item.status ?? 'collected'),
    toStatus: 'received',
    notes: data.notes ?? null,
  });

  await createAuditLog(c.env, tenantId, userId, 'RECEIVE', 'lab_order_items', itemId, item, {
    status: 'received',
    received_by: userId,
  });

  return c.json({ message: 'Sample received in laboratory', item_id: itemId });
});

labWorkflowRoutes.post('/items/:itemId/storage', zValidator('json', sampleStorageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, loi.lab_test_id, loi.status, loi.sample_status, lo.patient_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first<Record<string, unknown>>();

  if (!item) {
    throw new HTTPException(404, { message: 'Lab order item not found' });
  }
  const status = String(item.status ?? '').toLowerCase();
  if (['pending', 'cancelled', 'canceled', 'rejected'].includes(status)) {
    throw new HTTPException(400, { message: `Cannot store sample from status '${item.status}'` });
  }

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET sample_storage_fridge = ?,
        sample_storage_rack = ?,
        sample_storage_box = ?,
        sample_storage_position = ?,
        sample_storage_condition = ?,
        sample_stored_at = ${workflowNow()},
        sample_stored_by = ?,
        notes = COALESCE(?, notes),
        updated_at = ${workflowNow()}
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.fridge ?? null,
    data.rack ?? null,
    data.box ?? null,
    data.position ?? null,
    data.storage_condition ?? null,
    userId,
    data.notes ?? null,
    itemId,
    tenantId,
  ).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'sample_stored',
    eventStage: 'storage',
    labOrderId: toNumber(item.lab_order_id),
    labOrderItemId: itemId,
    patientId: toNumber(item.patient_id),
    fromStatus: String(item.sample_status ?? item.status ?? null),
    toStatus: 'stored',
    notes: data.notes ?? null,
    metadata: {
      fridge: data.fridge ?? null,
      rack: data.rack ?? null,
      box: data.box ?? null,
      position: data.position ?? null,
      storageCondition: data.storage_condition ?? null,
    },
  });

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'lab_order_items', itemId, item, {
    workflow_action: 'STORE_SAMPLE',
    sample_storage_fridge: data.fridge ?? null,
    sample_storage_rack: data.rack ?? null,
    sample_storage_box: data.box ?? null,
    sample_storage_position: data.position ?? null,
    sample_storage_condition: data.storage_condition ?? null,
  });

  return c.json({ message: 'Sample storage location recorded', item_id: itemId });
});

labWorkflowRoutes.post('/items/:itemId/referral', zValidator('json', sampleReferralSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, loi.lab_test_id, loi.status, loi.sample_status, lo.patient_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first<Record<string, unknown>>();

  if (!item) {
    throw new HTTPException(404, { message: 'Lab order item not found' });
  }
  const status = String(item.status ?? '').toLowerCase();
  if (['pending', 'cancelled', 'canceled', 'rejected'].includes(status)) {
    throw new HTTPException(400, { message: `Cannot refer sample from status '${item.status}'` });
  }

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET sample_status = 'referred_out',
        referral_lab_name = ?,
        referral_contact = ?,
        referral_tracking_no = ?,
        referral_reason = ?,
        referral_status = 'sent',
        referred_at = ${workflowNow()},
        referred_by = ?,
        expected_return_at = ?,
        notes = COALESCE(?, notes),
        updated_at = ${workflowNow()}
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.referral_lab_name,
    data.referral_contact ?? null,
    data.referral_tracking_no ?? null,
    data.referral_reason ?? null,
    userId,
    data.expected_return_at ?? null,
    data.notes ?? null,
    itemId,
    tenantId,
  ).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'sample_referred_out',
    eventStage: 'referral',
    labOrderId: toNumber(item.lab_order_id),
    labOrderItemId: itemId,
    patientId: toNumber(item.patient_id),
    fromStatus: String(item.sample_status ?? item.status ?? null),
    toStatus: 'referred_out',
    notes: data.notes ?? null,
    metadata: {
      referralLabName: data.referral_lab_name,
      referralContact: data.referral_contact ?? null,
      referralTrackingNo: data.referral_tracking_no ?? null,
      referralReason: data.referral_reason ?? null,
      expectedReturnAt: data.expected_return_at ?? null,
    },
  });

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'lab_order_items', itemId, item, {
    workflow_action: 'REFER_SAMPLE',
    sample_status: 'referred_out',
    referral_lab_name: data.referral_lab_name,
    referral_tracking_no: data.referral_tracking_no ?? null,
  });

  return c.json({ message: 'Sample referral recorded', item_id: itemId, referral_status: 'sent' });
});

labWorkflowRoutes.post('/items/:itemId/process', zValidator('json', receiveSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, loi.lab_test_id, loi.status, lo.patient_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON loi.lab_order_id = lo.id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first<Record<string, unknown>>();

  if (!item) {
    throw new HTTPException(404, { message: 'Lab order item not found' });
  }

  if (!isLabStatusTransitionAllowed(String(item.status ?? 'pending'), 'processing')) {
    throw new HTTPException(400, { message: `Cannot process sample from status '${item.status}'` });
  }

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET status = 'processing',
        notes = COALESCE(?, notes),
        updated_at = ${workflowNow()}
    WHERE id = ? AND tenant_id = ?
  `).bind(data.notes ?? null, itemId, tenantId).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'sample_processing',
    eventStage: 'processing',
    labOrderId: toNumber(item.lab_order_id),
    labOrderItemId: itemId,
    patientId: toNumber(item.patient_id),
    fromStatus: String(item.status ?? 'received'),
    toStatus: 'processing',
    notes: data.notes ?? null,
  });

  await createAuditLog(c.env, tenantId, userId, 'PROCESS', 'lab_order_items', itemId, item, {
    status: 'processing',
  });

  return c.json({ message: 'Sample processing started', item_id: itemId });
});

labWorkflowRoutes.post('/reports/:reportId/verify', requireRole(...LAB_REPORT_GOVERNANCE_ROLES), zValidator('json', reviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const reportId = Number(c.req.param('reportId'));
  const data = c.req.valid('json');

  const report = await db.$client.prepare(`
    SELECT lr.id, lr.lab_order_id, lr.review_status, lr.report_status, lo.patient_id
    FROM lab_reports lr
    JOIN lab_orders lo ON lo.id = lr.lab_order_id
    WHERE lr.id = ? AND lr.tenant_id = ?
  `).bind(reportId, tenantId).first<Record<string, unknown>>();

  if (!report) {
    throw new HTTPException(404, { message: 'Lab report not found' });
  }
  assertLabReportNotRetracted(report, 'verified');

  await db.$client.prepare(`
    UPDATE lab_reports
    SET review_status = 'verified',
        reviewed_by = ?,
        reviewed_at = ${workflowNow()},
        review_notes = COALESCE(?, review_notes)
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, data.notes ?? null, reportId, tenantId).run();

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET result_status = 'verified',
        updated_at = ${workflowNow()}
    WHERE lab_order_id = ? AND tenant_id = ? AND status = 'completed'
  `).bind(report.lab_order_id, tenantId).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'result_verified',
    eventStage: 'verification',
    labOrderId: toNumber(report.lab_order_id),
    labReportId: reportId,
    patientId: toNumber(report.patient_id),
    fromStatus: String(report.review_status ?? 'pending'),
    toStatus: 'verified',
    notes: data.notes ?? null,
  });

  await createAuditLog(c.env, tenantId, userId, 'VERIFY', 'lab_reports', reportId, report, {
    review_status: 'verified',
    reviewed_by: userId,
  });

  return c.json({ message: 'Report verified', report_id: reportId });
});

labWorkflowRoutes.post('/reports/:reportId/validate', requireRole(...LAB_REPORT_GOVERNANCE_ROLES), zValidator('json', validateSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const reportId = Number(c.req.param('reportId'));
  const data = c.req.valid('json');

  const report = await db.$client.prepare(`
    SELECT lr.id, lr.lab_order_id, lr.review_status, lr.report_status, lr.delivery_status, lo.patient_id
    FROM lab_reports lr
    JOIN lab_orders lo ON lo.id = lr.lab_order_id
    WHERE lr.id = ? AND lr.tenant_id = ?
  `).bind(reportId, tenantId).first<Record<string, unknown>>();

  if (!report) {
    throw new HTTPException(404, { message: 'Lab report not found' });
  }
  assertLabReportNotRetracted(report, 'published');

  const signatoryIds = data.signatory_ids ? JSON.stringify(data.signatory_ids) : null;

  await db.$client.prepare(`
    UPDATE lab_reports
    SET review_status = 'validated',
        report_status = 'published',
        validated_by = ?,
        validated_at = ${workflowNow()},
        published_at = ${workflowNow()},
        signatory_ids = COALESCE(?, signatory_ids),
        review_notes = COALESCE(?, review_notes),
        delivery_status = COALESCE(NULLIF(delivery_status, ''), 'pending')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, signatoryIds, data.notes ?? null, reportId, tenantId).run();

  await db.$client.prepare(`
    UPDATE lab_order_items
    SET status = CASE WHEN status = 'completed' THEN 'verified' ELSE status END,
        result_status = 'validated',
        verified_by = ?,
        verified_at = ${workflowNow()},
        updated_at = ${workflowNow()}
    WHERE lab_order_id = ? AND tenant_id = ? AND status IN ('completed', 'verified')
  `).bind(userId, report.lab_order_id, tenantId).run();

  await db.$client.prepare(`
    UPDATE lab_orders
    SET status = 'verified', updated_at = ${workflowNow()}
    WHERE id = ? AND tenant_id = ?
  `).bind(report.lab_order_id, tenantId).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'result_validated',
    eventStage: 'validation',
    labOrderId: toNumber(report.lab_order_id),
    labReportId: reportId,
    patientId: toNumber(report.patient_id),
    fromStatus: String(report.review_status ?? 'verified'),
    toStatus: 'validated',
    notes: data.notes ?? null,
    metadata: { published: true, signatory_ids: data.signatory_ids ?? [] },
  });

  await createAuditLog(c.env, tenantId, userId, 'VALIDATE', 'lab_reports', reportId, report, {
    review_status: 'validated',
    report_status: 'published',
    validated_by: userId,
  });

  return c.json({ message: 'Report validated and published', report_id: reportId });
});

labWorkflowRoutes.post('/reports/:reportId/deliver', zValidator('json', deliverSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const reportId = Number(c.req.param('reportId'));
  const data = c.req.valid('json');

  const report = await db.$client.prepare(`
    SELECT lr.id, lr.lab_order_id, lr.report_status, lr.delivery_status, lo.patient_id
    FROM lab_reports lr
    JOIN lab_orders lo ON lo.id = lr.lab_order_id
    WHERE lr.id = ? AND lr.tenant_id = ?
  `).bind(reportId, tenantId).first<Record<string, unknown>>();

  if (!report) {
    throw new HTTPException(404, { message: 'Lab report not found' });
  }

  if (String(report.report_status ?? 'pending') !== 'published') {
    throw new HTTPException(400, { message: 'Only published reports can be delivered' });
  }

  await db.$client.prepare(`
    INSERT INTO lab_report_deliveries (
      lab_report_id,
      lab_order_id,
      delivery_method,
      recipient_name,
      recipient_contact,
      copy_count,
      delivered_by,
      notes,
      tenant_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${workflowNow()})
  `).bind(
    reportId,
    report.lab_order_id,
    data.delivery_method,
    data.recipient_name ?? null,
    data.recipient_contact ?? null,
    data.copy_count,
    userId,
    data.notes ?? null,
    tenantId,
  ).run();

  await db.$client.prepare(`
    UPDATE lab_reports
    SET delivered_via = ?,
        delivered_at = ${workflowNow()},
        delivery_status = 'delivered',
        printed_at = CASE WHEN ? = 'print' THEN ${workflowNow()} ELSE printed_at END,
        print_count = CASE WHEN ? = 'print' THEN COALESCE(print_count, 0) + ? ELSE COALESCE(print_count, 0) END
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.delivery_method,
    data.delivery_method,
    data.delivery_method,
    data.copy_count,
    reportId,
    tenantId,
  ).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'report_delivered',
    eventStage: 'delivery',
    labOrderId: toNumber(report.lab_order_id),
    labReportId: reportId,
    patientId: toNumber(report.patient_id),
    fromStatus: String(report.delivery_status ?? 'pending'),
    toStatus: 'delivered',
    notes: data.notes ?? null,
    metadata: {
      delivery_method: data.delivery_method,
      recipient_name: data.recipient_name ?? null,
      recipient_contact: data.recipient_contact ?? null,
      copy_count: data.copy_count,
    },
  });

  await createAuditLog(c.env, tenantId, userId, 'DELIVER', 'lab_reports', reportId, report, {
    delivery_method: data.delivery_method,
    recipient_name: data.recipient_name ?? null,
    copy_count: data.copy_count,
  });

  return c.json({ message: 'Report delivered', report_id: reportId });
});

labWorkflowRoutes.post('/critical/:itemId/acknowledge', zValidator('json', acknowledgeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.lab_order_id, loi.abnormal_flag, lo.patient_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first<Record<string, unknown>>();

  if (!item) {
    throw new HTTPException(404, { message: 'Critical result item not found' });
  }

  if (String(item.abnormal_flag ?? '') !== 'critical') {
    throw new HTTPException(400, { message: 'Only critical results can be acknowledged' });
  }

  await db.$client.prepare(`
    INSERT INTO lab_critical_acknowledgements (
      lab_order_item_id,
      acknowledged_by,
      acknowledged_to,
      notes,
      tenant_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ${workflowNow()})
  `).bind(itemId, userId, data.acknowledged_to ?? null, data.notes ?? null, tenantId).run();

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'critical_acknowledged',
    eventStage: 'critical',
    labOrderId: toNumber(item.lab_order_id),
    labOrderItemId: itemId,
    patientId: toNumber(item.patient_id),
    fromStatus: 'critical',
    toStatus: 'acknowledged',
    notes: data.notes ?? null,
    metadata: { acknowledged_to: data.acknowledged_to ?? null },
  });

  await createAuditLog(c.env, tenantId, userId, 'ACK_CRITICAL', 'lab_order_items', itemId, null, {
    acknowledged_to: data.acknowledged_to ?? null,
    notes: data.notes ?? null,
  });

  return c.json({ message: 'Critical result acknowledged', item_id: itemId });
});

labWorkflowRoutes.post('/reports/:reportId/correct', requireRole(...LAB_REPORT_GOVERNANCE_ROLES), zValidator('json', correctionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const reportId = Number(c.req.param('reportId'));
  const data = c.req.valid('json');

  const report = await db.$client.prepare(`
    SELECT lr.id, lr.lab_order_id, lr.report_status, lr.review_status, lo.patient_id
    FROM lab_reports lr
    JOIN lab_orders lo ON lo.id = lr.lab_order_id
    WHERE lr.id = ? AND lr.tenant_id = ?
  `).bind(reportId, tenantId).first<Record<string, unknown>>();

  if (!report) {
    throw new HTTPException(404, { message: 'Lab report not found' });
  }

  if (!['published', 'corrected'].includes(String(report.report_status ?? 'pending'))) {
    throw new HTTPException(400, { message: 'Only validated or previously corrected reports can be corrected' });
  }

  const touchedTestIds = new Set<number>();
  const correctedFlags: Record<number, string> = {};

  for (const correction of data.results) {
    const existing = await db.$client.prepare(`
      SELECT lr.id, lr.lab_test_id, lr.component_id, lr.result_value, lr.result_numeric, lr.comments,
             COALESCE(ltc_component.normal_range, ltc.normal_range) AS normal_range,
             COALESCE(ltc_component.critical_low, ltc.critical_low) AS critical_low,
             COALESCE(ltc_component.critical_high, ltc.critical_high) AS critical_high,
             p.gender,
             p.date_of_birth
      FROM lab_results lr
      JOIN lab_reports lrp ON lrp.id = lr.lab_report_id
      JOIN lab_orders lo ON lo.id = lrp.lab_order_id
      JOIN patients p ON p.id = lo.patient_id
      JOIN lab_test_catalog ltc ON ltc.id = lr.lab_test_id
      LEFT JOIN lab_test_components ltc_component ON ltc_component.id = lr.component_id
      WHERE lr.id = ? AND lr.lab_report_id = ? AND lr.tenant_id = ?
    `).bind(correction.result_id, reportId, tenantId).first<Record<string, unknown>>();

    if (!existing) {
      throw new HTTPException(404, { message: `Lab result ${correction.result_id} not found for this report` });
    }

    const newNumeric = Number.parseFloat(correction.result_value);
    const normalizedNumeric = Number.isFinite(newNumeric) ? newNumeric : null;
    const abnormalFlag = await calculateCorrectedAbnormalFlag(db, tenantId, existing, normalizedNumeric);

    await db.$client.prepare(`
      INSERT INTO lab_result_corrections (
        lab_report_id,
        lab_result_id,
        previous_result_value,
        previous_result_numeric,
        new_result_value,
        new_result_numeric,
        correction_reason,
        correction_notes,
        corrected_by,
        tenant_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${workflowNow()})
    `).bind(
      reportId,
      correction.result_id,
      existing.result_value ?? null,
      existing.result_numeric ?? null,
      correction.result_value,
      normalizedNumeric,
      data.reason,
      correction.comments ?? data.notes ?? null,
      userId,
      tenantId,
    ).run();

    await db.$client.prepare(`
      UPDATE lab_results
      SET result_value = ?,
          result_numeric = ?,
          abnormal_flag = ?,
          comments = COALESCE(?, comments),
          result_status = 'corrected',
          updated_at = ${workflowNow()}
      WHERE id = ? AND tenant_id = ?
    `).bind(
      correction.result_value,
      normalizedNumeric,
      abnormalFlag,
      correction.comments ?? null,
      correction.result_id,
      tenantId,
    ).run();

    touchedTestIds.add(toNumber(existing.lab_test_id));
    correctedFlags[correction.result_id] = abnormalFlag;
  }

  await db.$client.prepare(`
    UPDATE lab_reports
    SET report_status = 'corrected',
        review_status = 'pending',
        corrected_at = ${workflowNow()},
        correction_count = COALESCE(correction_count, 0) + ?,
        review_notes = COALESCE(?, review_notes)
    WHERE id = ? AND tenant_id = ?
  `).bind(data.results.length, data.notes ?? null, reportId, tenantId).run();

  const testIds = [...touchedTestIds];
  const refreshedFlags: Record<number, string> = {};
  for (const testId of testIds) {
    refreshedFlags[testId] = await refreshOrderItemAbnormalFlag(
      db,
      tenantId,
      reportId,
      toNumber(report.lab_order_id),
      testId,
    );
  }

  await recordLabWorkflowEvent(c.env.DB, {
    tenantId,
    userId,
    actorRole: role ?? null,
    eventType: 'result_corrected',
    eventStage: 'correction',
    labOrderId: toNumber(report.lab_order_id),
    labReportId: reportId,
    patientId: toNumber(report.patient_id),
    fromStatus: String(report.report_status ?? 'published'),
    toStatus: 'corrected',
    notes: data.notes ?? data.reason,
    metadata: {
      reason: data.reason,
      corrected_result_ids: data.results.map((row) => row.result_id),
      corrected_flags: correctedFlags,
      order_item_flags: refreshedFlags,
    },
  });

  await createAuditLog(c.env, tenantId, userId, 'CORRECT', 'lab_reports', reportId, report, {
    reason: data.reason,
    corrected_result_ids: data.results.map((row) => row.result_id),
  });

  return c.json({ message: 'Result correction saved and queued for revalidation', report_id: reportId });
});

// --- Department CRUD ---

labWorkflowRoutes.get('/departments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const departments = await db.$client.prepare(`
    SELECT d.id, d.department_code, d.department_name, d.queue_prefix,
           d.report_header, d.report_footer, d.tat_target_minutes, d.is_active,
           d.created_at, d.updated_at,
           COUNT(du.id) AS user_count
    FROM lab_departments d
    LEFT JOIN lab_department_users du ON du.department_id = d.id
    WHERE d.tenant_id = ?
    GROUP BY d.id
    ORDER BY d.department_name ASC
  `).bind(tenantId).all<Record<string, unknown>>();

  return c.json({ departments: departments.results ?? [] });
});

labWorkflowRoutes.post('/departments', zValidator('json', createDepartmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(`
    SELECT id FROM lab_departments
    WHERE tenant_id = ? AND department_code = UPPER(?)
    LIMIT 1
  `).bind(tenantId, data.department_code).first<{ id: number }>();

  if (existing) {
    throw new HTTPException(409, { message: `Department code "${data.department_code}" already exists` });
  }

  const result = await db.$client.prepare(`
    INSERT INTO lab_departments (
      department_code, department_name, queue_prefix,
      report_header, report_footer, tat_target_minutes,
      tenant_id, created_at, updated_at
    ) VALUES (UPPER(?), ?, ?, ?, ?, ?, ?, ${workflowNow()}, ${workflowNow()})
  `).bind(
    data.department_code,
    data.department_name,
    data.queue_prefix ?? data.department_code.substring(0, 4).toUpperCase(),
    data.report_header ?? null,
    data.report_footer ?? null,
    data.tat_target_minutes ?? null,
    tenantId,
  ).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'lab_departments', result.meta.last_row_id as number, null, {
    department_code: data.department_code,
    department_name: data.department_name,
  });

  return c.json({ message: 'Department created', id: result.meta.last_row_id }, 201);
});

labWorkflowRoutes.put('/departments/:id', zValidator('json', updateDepartmentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const deptId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(`
    SELECT id, department_code, department_name FROM lab_departments
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(deptId, tenantId).first<Record<string, unknown>>();

  if (!existing) {
    throw new HTTPException(404, { message: 'Department not found' });
  }

  const fields: string[] = [];
  const values: Array<string | number | null> = [];

  if (data.department_name !== undefined) { fields.push('department_name = ?'); values.push(data.department_name); }
  if (data.queue_prefix !== undefined) { fields.push('queue_prefix = ?'); values.push(data.queue_prefix); }
  if (data.report_header !== undefined) { fields.push('report_header = ?'); values.push(data.report_header); }
  if (data.report_footer !== undefined) { fields.push('report_footer = ?'); values.push(data.report_footer); }
  if (data.tat_target_minutes !== undefined) { fields.push('tat_target_minutes = ?'); values.push(data.tat_target_minutes); }
  if (data.is_active !== undefined) { fields.push('is_active = ?'); values.push(data.is_active); }

  if (fields.length === 0) {
    return c.json({ message: 'No changes' });
  }

  fields.push(`updated_at = ${workflowNow()}`);
  values.push(deptId, tenantId);

  await db.$client.prepare(`
    UPDATE lab_departments SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?
  `).bind(...values).run();

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'lab_departments', deptId, existing, data);

  return c.json({ message: 'Department updated', id: deptId });
});

labWorkflowRoutes.get('/departments/:id/users', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const deptId = Number(c.req.param('id'));

  const department = await db.$client.prepare(`
    SELECT id FROM lab_departments WHERE id = ? AND tenant_id = ?
  `).bind(deptId, tenantId).first<{ id: number }>();

  if (!department) {
    throw new HTTPException(404, { message: 'Department not found' });
  }

  const users = await db.$client.prepare(`
    SELECT du.id, du.user_id, du.workflow_role,
           du.can_collect, du.can_receive, du.can_deliver, du.can_verify, du.can_validate,
           u.name AS user_name, u.email AS user_email
    FROM lab_department_users du
    LEFT JOIN users u ON u.id = du.user_id
    WHERE du.department_id = ?
    ORDER BY u.name ASC
  `).bind(deptId).all<Record<string, unknown>>();

  return c.json({ users: users.results ?? [] });
});

labWorkflowRoutes.post('/departments/:id/users', zValidator('json', assignDepartmentUserSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const deptId = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const department = await db.$client.prepare(`
    SELECT id, department_name FROM lab_departments WHERE id = ? AND tenant_id = ?
  `).bind(deptId, tenantId).first<{ id: number; department_name: string }>();

  if (!department) {
    throw new HTTPException(404, { message: 'Department not found' });
  }

  const existing = await db.$client.prepare(`
    SELECT id FROM lab_department_users WHERE department_id = ? AND user_id = ?
  `).bind(deptId, data.user_id).first<{ id: number }>();

  if (existing) {
    throw new HTTPException(409, { message: 'User already assigned to this department' });
  }

  await db.$client.prepare(`
    INSERT INTO lab_department_users (
      department_id, user_id, workflow_role,
      can_collect, can_receive, can_deliver, can_verify, can_validate,
      tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    deptId, data.user_id, data.workflow_role,
    data.can_collect, data.can_receive, data.can_deliver, data.can_verify, data.can_validate,
    tenantId,
  ).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'lab_department_users', deptId, null, {
    assigned_user_id: data.user_id,
    workflow_role: data.workflow_role,
    department_name: department.department_name,
  });

  return c.json({ message: 'User assigned to department' }, 201);
});

labWorkflowRoutes.delete('/departments/:deptId/users/:userId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const currentUserId = requireUserId(c);
  const deptId = Number(c.req.param('deptId'));
  const targetUserId = Number(c.req.param('userId'));

  const department = await db.$client.prepare(`
    SELECT id FROM lab_departments WHERE id = ? AND tenant_id = ?
  `).bind(deptId, tenantId).first<{ id: number }>();

  if (!department) {
    throw new HTTPException(404, { message: 'Department not found' });
  }

  const result = await db.$client.prepare(`
    DELETE FROM lab_department_users WHERE department_id = ? AND user_id = ?
  `).bind(deptId, targetUserId).run();

  if (result.meta.changes === 0) {
    throw new HTTPException(404, { message: 'User assignment not found' });
  }

  await createAuditLog(c.env, tenantId, currentUserId, 'DELETE', 'lab_department_users', deptId, null, {
    removed_user_id: targetUserId,
  });

  return c.json({ message: 'User removed from department' });
});

export default labWorkflowRoutes;

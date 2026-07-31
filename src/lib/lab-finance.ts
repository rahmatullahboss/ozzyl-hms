import { ACCOUNTING_EVENT_TYPES, recordAccountingPostingEvent } from './accounting-posting';
import { getTodayGMT6 } from './date-utils';
import { roundMoney } from './discount_allocation';
import {
  calculateDoctorCommissionWaiver,
  normalizeDoctorCommissionWaiverPolicy,
  type DoctorCommissionWaiverPolicy,
} from './doctor-commission-waiver-policy';
import {
  executeLiveDoctorCommissionAccrual,
  type LiveDoctorCommissionRuleInput,
} from './canonical/live-doctor-compensation';
import { isLabTestCommissionEligible, loadLabTestCommissionEligibility } from './lab-test-commission-policy';
import { cancelDoctorCommissionAccrualsWithCanonicalAdjustment } from './canonical/compensation-accrual-route-integration';
import type { CommissionReasonCode } from '../services/dashboard/doctorReportingContract';

export type DoctorCommissionRateType = 'percent' | 'flat';

export interface CommissionCalculationInput {
  grossAmount: number;
  rateType: DoctorCommissionRateType;
  rateValue: number;
}

export interface ProfitCalculationInput {
  revenue: number;
  consumableCost: number;
  doctorCommission: number;
}

export interface ProfitCalculationResult {
  grossProfit: number;
  marginPercent: number;
}

export interface LabOrderCommissionItem {
  labOrderItemId: number;
  labTestId: number;
  category: string | null;
  lineTotal: number;
}

export interface AccrueLabOrderDoctorCommissionsInput {
  tenantId: string | number;
  userId: string | number;
  patientId: number;
  visitId: number | null;
  billId: number | null;
  labOrderId: number;
  orderDate: string;
  items: LabOrderCommissionItem[];
}

interface DoctorCommissionRuleRow {
  id: number;
  canonical_source_key: string | null;
  rule_version: number;
  service_type: 'lab_test' | 'consultation_fee' | 'referral';
  lab_test_id: number | null;
  category: string | null;
  rate_type: DoctorCommissionRateType;
  rate_value: number;
  waiver_policy: DoctorCommissionWaiverPolicy | null;
  protected_rate_bps: number | null;
  protected_flat_amount: number | null;
  incentive_type: 'performer' | 'prescriber' | 'referrer';
  effective_from: string | null;
  effective_to: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}

function trackedLegacyRuleVersion(rule: Pick<DoctorCommissionRuleRow, 'rule_version'>): number {
  const version = Number(rule.rule_version);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

function commissionReasonForAccrual(input: {
  commissionBaseAmount: number;
  earnedAmount: number;
  waiverAmount: number;
  payableAmount: number;
}): CommissionReasonCode {
  if (input.payableAmount > 0) return 'rule_matched';
  if (input.waiverAmount > 0 && input.earnedAmount > 0) return 'doctor_waived';
  if (input.commissionBaseAmount <= 0) return 'eligible_base_zero';
  return 'held_for_review';
}

interface DoctorCanonicalIdentityRow {
  name: string;
  specialty: string | null;
  department: string | null;
  bmdc_reg_no: string | null;
  is_active: number | null;
  user_id: number | null;
  canonical_source_key: string | null;
}

export function calculateCommissionAmount(input: CommissionCalculationInput): number {
  const grossAmount = Math.max(0, roundMoney(input.grossAmount || 0));
  const rateValue = Math.max(0, Number(input.rateValue || 0));

  if (input.rateType === 'percent') {
    return roundMoney((grossAmount * rateValue) / 10_000);
  }

  return roundMoney(rateValue);
}

interface CommissionAllocation {
  amount: number;
  cumulativeBaseBefore: number;
}

function createCumulativeCommissionAllocator() {
  const cumulativeBaseByKey = new Map<string, number>();

  return (input: CommissionCalculationInput & { allocationKey: string }): CommissionAllocation => {
    if (input.rateType !== 'percent') {
      return {
        amount: calculateCommissionAmount(input),
        cumulativeBaseBefore: 0,
      };
    }

    const previousBase = cumulativeBaseByKey.get(input.allocationKey) ?? 0;
    const nextBase = roundMoney(previousBase + Math.max(0, roundMoney(input.grossAmount)));
    const previousAmount = calculateCommissionAmount({
      grossAmount: previousBase,
      rateType: input.rateType,
      rateValue: input.rateValue,
    });
    const nextAmount = calculateCommissionAmount({
      grossAmount: nextBase,
      rateType: input.rateType,
      rateValue: input.rateValue,
    });
    cumulativeBaseByKey.set(input.allocationKey, nextBase);
    return {
      amount: roundMoney(Math.max(0, nextAmount - previousAmount)),
      cumulativeBaseBefore: previousBase,
    };
  };
}

export function capConsultationCommissionAtCollectedAmount(grossAmount: number, commissionAmount: number): number {
  return roundMoney(Math.min(
    Math.max(0, roundMoney(grossAmount || 0)),
    Math.max(0, roundMoney(commissionAmount || 0)),
  ));
}

export function normalizeCommissionRuleRateValue(rateType: DoctorCommissionRateType, rateValue: number): number {
  const normalized = Math.max(0, Math.round(Number(rateValue || 0)));
  if (rateType !== 'percent') return normalized;
  return normalized <= 100 ? normalized * 100 : normalized;
}

export function calculateGrossProfit(input: ProfitCalculationInput): ProfitCalculationResult {
  const revenue = Math.max(0, Math.round(input.revenue || 0));
  const consumableCost = Math.max(0, Math.round(input.consumableCost || 0));
  const doctorCommission = Math.max(0, Math.round(input.doctorCommission || 0));
  const grossProfit = revenue - consumableCost - doctorCommission;
  const marginPercent = revenue > 0 ? Number(((grossProfit / revenue) * 100).toFixed(1)) : 0;

  return { grossProfit, marginPercent };
}

function isDiagnosticCommissionItem(itemCategory: string): boolean {
  return /^(test|lab|laboratory|diagnostic|radiology|imaging|usg|xray|x-ray|pathology)$/i.test(itemCategory || '');
}

function isMissingFinanceTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table: doctor_commission_(rules|accruals)/i.test(message);
}

function isMissingPerformerReserveTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table: diagnostic_performer_reserves/i.test(message);
}

async function recordCommissionAccrualAccountingEvent(
  db: D1Database,
  input: {
    tenantId: string | number;
    userId: string | number;
    patientId: number;
    visitId: number | null;
    billId: number | null;
    accrualDate: string;
    accrualId: string | number;
    doctorId: number;
    sourceType: string;
    grossAmount: number;
    amount: number;
  },
): Promise<void> {
  await recordAccountingPostingEvent(db, {
    tenantId: String(input.tenantId),
    sourceType: 'doctor_commission_accrual',
    sourceId: input.accrualId,
    eventType: ACCOUNTING_EVENT_TYPES.commissionAccrued,
    eventDate: input.accrualDate,
    createdBy: input.userId,
    payload: {
      accrualId: input.accrualId,
      doctorId: input.doctorId,
      patientId: input.patientId,
      visitId: input.visitId,
      billId: input.billId,
      commissionSourceType: input.sourceType,
      grossAmount: input.grossAmount,
      amount: input.amount,
    },
  });
}

async function recordCommissionCancellationAccountingEvent(
  db: D1Database,
  input: {
    tenantId: string | number;
    userId: string | number;
    patientId: number | null;
    visitId: number | null;
    billId: number | null;
    accrualId: string | number;
    doctorId: number;
    sourceType: string;
    grossAmount: number;
    amount: number;
    cancellationDate: string;
    reason: string;
  },
): Promise<void> {
  await recordAccountingPostingEvent(db, {
    tenantId: String(input.tenantId),
    sourceType: 'doctor_commission_accrual',
    sourceId: input.accrualId,
    eventType: ACCOUNTING_EVENT_TYPES.commissionCancelled,
    eventDate: input.cancellationDate,
    createdBy: input.userId,
    payload: {
      accrualId: input.accrualId,
      doctorId: input.doctorId,
      patientId: input.patientId,
      visitId: input.visitId,
      billId: input.billId,
      commissionSourceType: input.sourceType,
      grossAmount: input.grossAmount,
      amount: input.amount,
      reason: input.reason,
    },
  });
}

function getAccrualEventSourceId(result: unknown, fallback: string): string | number {
  const rowId = Number((result as { meta?: { last_row_id?: unknown } })?.meta?.last_row_id);
  return Number.isFinite(rowId) && rowId > 0 ? rowId : fallback;
}

async function getVisitDoctorId(db: D1Database, tenantId: string | number, visitId: number): Promise<number | null> {
  const row = await db.prepare(
    'SELECT doctor_id FROM visits WHERE id = ? AND tenant_id = ?',
  ).bind(visitId, tenantId).first<{ doctor_id: number | null }>();

  return row?.doctor_id ?? null;
}

async function getDoctorIdByUserId(db: D1Database, tenantId: string | number, userId: string | number): Promise<number | null> {
  const row = await db.prepare(
    'SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1',
  ).bind(userId, tenantId).first<{ id: number }>();

  return row?.id ?? null;
}

async function findDoctorCommissionRule(
  db: D1Database,
  input: {
    tenantId: string | number;
    doctorId: number;
    serviceType: 'lab_test' | 'consultation_fee' | 'referral';
    incentiveType: 'performer' | 'prescriber' | 'referrer';
    labTestId?: number | null;
    category?: string | null;
    serviceDate: string;
    commissionEligible?: boolean;
  },
): Promise<DoctorCommissionRuleRow | null> {
  const labTestId = input.labTestId ?? null;
  const category = input.category ?? null;
  if (labTestId !== null) {
    const commissionEligible = input.commissionEligible
      ?? await isLabTestCommissionEligible(db, input.tenantId, labTestId);
    if (!commissionEligible) return null;
  }

  return db.prepare(`
    SELECT id, canonical_source_key, rule_version, service_type, lab_test_id, category, rate_type, rate_value,
           waiver_policy, protected_rate_bps, protected_flat_amount,
           incentive_type, effective_from, effective_to, is_active, created_at, updated_at
    FROM doctor_commission_rules
    WHERE tenant_id = ?
      AND doctor_id = ?
      AND service_type = ?
      AND incentive_type = ?
      AND is_active = 1
      AND (lab_test_id = ? OR lab_test_id IS NULL)
      AND (category = ? OR category IS NULL OR category = '')
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY
      CASE
        WHEN lab_test_id = ? THEN 0
        WHEN category = ? THEN 1
        ELSE 2
      END,
      id DESC
    LIMIT 1
  `).bind(
    input.tenantId,
    input.doctorId,
    input.serviceType,
    input.incentiveType,
    labTestId,
    category,
    input.serviceDate,
    input.serviceDate,
    labTestId,
    category,
  ).first<DoctorCommissionRuleRow>();
}

async function loadDoctorCommissionRulesForPreview(
  db: D1Database,
  input: { tenantId: string | number; doctorId: number; serviceDate: string },
): Promise<DoctorCommissionRuleRow[]> {
  const { results } = await db.prepare(`
    SELECT id, canonical_source_key, rule_version, service_type, lab_test_id, category, rate_type, rate_value,
           waiver_policy, protected_rate_bps, protected_flat_amount,
           incentive_type, effective_from, effective_to, is_active, created_at, updated_at
    FROM doctor_commission_rules
    WHERE tenant_id = ?
      AND doctor_id = ?
      AND is_active = 1
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY id DESC
  `).bind(
    input.tenantId,
    input.doctorId,
    input.serviceDate,
    input.serviceDate,
  ).all<DoctorCommissionRuleRow>();

  return results ?? [];
}

function selectDoctorCommissionRuleForPreview(
  rules: DoctorCommissionRuleRow[],
  input: {
    serviceType: DoctorCommissionRuleRow['service_type'];
    incentiveType: DoctorCommissionRuleRow['incentive_type'];
    labTestId?: number | null;
    category?: string | null;
  },
): DoctorCommissionRuleRow | null {
  const labTestId = input.labTestId ?? null;
  const category = input.category ?? null;
  let selected: DoctorCommissionRuleRow | null = null;
  let selectedRank = Number.POSITIVE_INFINITY;

  for (const rule of rules) {
    if (rule.service_type !== input.serviceType || rule.incentive_type !== input.incentiveType) continue;
    const ruleLabTestId = rule.lab_test_id ?? null;
    const ruleCategory = rule.category ?? null;
    if (ruleLabTestId !== null && ruleLabTestId !== labTestId) continue;
    if (ruleCategory !== null && ruleCategory !== '' && ruleCategory !== category) continue;

    const rank = ruleLabTestId !== null && ruleLabTestId === labTestId
      ? 0
      : ruleCategory !== null && ruleCategory !== '' && ruleCategory === category
        ? 1
        : 2;
    if (!selected || rank < selectedRank || (rank === selectedRank && rule.id > selected.id)) {
      selected = rule;
      selectedRank = rank;
    }
  }

  return selected;
}

export interface DoctorCommissionPreviewItem {
  itemCategory: string;
  description?: string | null;
  lineTotal: number;
  grossLineTotal?: number | null;
  performerReserveAmount?: number | null;
  referenceId?: number | null;
  labTestId?: number | null;
  quantity?: number | null;
}

export interface DoctorCommissionPreviewLine {
  itemCategory: string;
  description: string | null;
  sourceType: 'lab_test' | 'consultation_fee' | 'referral';
  incentiveType: 'performer' | 'prescriber' | 'referrer';
  grossAmount: number;
  commissionAmount: number;
  protectedCommissionAmount: number;
  maximumWaiverAmount: number;
  waiverPolicy: DoctorCommissionWaiverPolicy;
  ruleId: number;
}

export interface DoctorCommissionPreviewResult {
  doctorId: number;
  eligibleCommissionAmount: number;
  protectedCommissionAmount: number;
  maximumDoctorWaiverAmount: number;
  lines: DoctorCommissionPreviewLine[];
}

export async function previewDoctorCommissionForItems(
  db: D1Database,
  input: {
    tenantId: string | number;
    doctorId: number;
    billDate: string;
    items: DoctorCommissionPreviewItem[];
  },
): Promise<DoctorCommissionPreviewResult> {
  const lines: DoctorCommissionPreviewLine[] = [];
  const allocateCommissionAmount = createCumulativeCommissionAllocator();
  const [commissionEligibility, previewRules] = await Promise.all([
    loadLabTestCommissionEligibility(
      db,
      input.tenantId,
      input.items.map((item) => item.labTestId),
    ),
    loadDoctorCommissionRulesForPreview(db, {
      tenantId: input.tenantId,
      doctorId: input.doctorId,
      serviceDate: input.billDate,
    }),
  ]);
  for (const item of input.items) {
    const labTestId = Number(item.labTestId ?? 0);
    const commissionEligible = !Number.isInteger(labTestId) || labTestId <= 0
      ? true
      : (commissionEligibility.get(labTestId) ?? true);
    if (!commissionEligible) continue;
    const itemCategory = String(item.itemCategory ?? '');
    const lineTotal = Math.max(0, roundMoney(item.lineTotal));
    const grossLineTotal = Math.max(lineTotal, roundMoney(item.grossLineTotal ?? lineTotal));
    const performerReserveAmount = Math.max(0, roundMoney(item.performerReserveAmount));
    if (lineTotal <= 0 && grossLineTotal <= 0) continue;

    const diagnosticItem = isDiagnosticCommissionItem(itemCategory);
    const primaryRule = diagnosticItem
      ? selectDoctorCommissionRuleForPreview(previewRules, {
          serviceType: 'lab_test',
          incentiveType: 'prescriber',
          labTestId: item.labTestId ?? null,
          category: itemCategory,
        })
      : null;

    const consultationRule = !primaryRule && itemCategory === 'doctor_visit'
      ? selectDoctorCommissionRuleForPreview(previewRules, {
          serviceType: 'consultation_fee',
          incentiveType: 'performer',
        })
      : null;

    const fallbackRule = primaryRule || consultationRule ? null : selectDoctorCommissionRuleForPreview(previewRules, {
      serviceType: 'referral',
      incentiveType: 'referrer',
      labTestId: item.labTestId ?? null,
      category: itemCategory,
    });

    const rule = primaryRule ?? consultationRule ?? fallbackRule;
    if (!rule) continue;

    const sourceType = primaryRule ? 'lab_test' : consultationRule ? 'consultation_fee' : 'referral';
    const incentiveType = primaryRule ? 'prescriber' : consultationRule ? 'performer' : 'referrer';
    const commissionBaseAmount = diagnosticItem
      ? roundMoney(Math.max(0, lineTotal - performerReserveAmount))
      : lineTotal;
    const commissionAllocation = allocateCommissionAmount({
      allocationKey: [input.doctorId, sourceType, incentiveType, rule.id].join(':'),
      grossAmount: commissionBaseAmount,
      rateType: rule.rate_type,
      rateValue: rule.rate_value,
    });
    const commissionAmount = sourceType === 'consultation_fee'
      ? capConsultationCommissionAtCollectedAmount(lineTotal, commissionAllocation.amount)
      : commissionAllocation.amount;
    if (commissionAmount <= 0) continue;

    const waiverCapacity = calculateDoctorCommissionWaiver({
      commissionBaseAmount,
      earnedCommissionAmount: commissionAmount,
      rateType: rule.rate_type,
      commissionRateValue: rule.rate_value,
      waiverPolicy: rule.waiver_policy,
      protectedRateBps: rule.protected_rate_bps,
      protectedFlatAmount: rule.protected_flat_amount,
      requestedWaiverAmount: 0,
    });
    lines.push({
      itemCategory,
      description: item.description ?? null,
      sourceType,
      incentiveType,
      grossAmount: commissionBaseAmount,
      commissionAmount,
      protectedCommissionAmount: waiverCapacity.protectedCommissionAmount,
      maximumWaiverAmount: waiverCapacity.maximumWaiverAmount,
      waiverPolicy: normalizeDoctorCommissionWaiverPolicy(rule.waiver_policy),
      ruleId: rule.id,
    });
  }

  return {
    doctorId: input.doctorId,
    eligibleCommissionAmount: roundMoney(lines.reduce((sum, line) => sum + line.commissionAmount, 0)),
    protectedCommissionAmount: roundMoney(lines.reduce((sum, line) => sum + line.protectedCommissionAmount, 0)),
    maximumDoctorWaiverAmount: roundMoney(lines.reduce((sum, line) => sum + line.maximumWaiverAmount, 0)),
    lines,
  };
}

export async function accrueLabOrderDoctorCommissions(
  db: D1Database,
  input: AccrueLabOrderDoctorCommissionsInput,
): Promise<number> {
  if (!input.visitId || input.items.length === 0) return 0;

  try {
    const doctorId = await getVisitDoctorId(db, input.tenantId, input.visitId);
    if (!doctorId) return 0;

    let inserted = 0;
    const commissionEligibility = await loadLabTestCommissionEligibility(
      db,
      input.tenantId,
      input.items.map((item) => item.labTestId),
    );
    for (const item of input.items) {
      const commissionEligible = commissionEligibility.get(item.labTestId) ?? true;
      if (!commissionEligible) continue;
      // In Danphe context, at order time, we accrue for the Prescriber (ordering doctor)
      const role = 'prescriber';

      const rule = await findDoctorCommissionRule(db, {
        tenantId: input.tenantId,
        doctorId,
        serviceType: 'lab_test',
        incentiveType: role,
        labTestId: item.labTestId,
        category: item.category,
        serviceDate: input.orderDate,
        commissionEligible,
      });

      if (!rule) continue;

      const commissionAmount = calculateCommissionAmount({
        grossAmount: item.lineTotal,
        rateType: rule.rate_type,
        rateValue: rule.rate_value,
      });

      if (commissionAmount <= 0) continue;

      const result = await db.prepare(`
        INSERT OR IGNORE INTO doctor_commission_accruals
          (tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_order_id, lab_order_item_id,
           lab_test_id, source_type, incentive_type, gross_amount, commission_rule_id,
           commission_rule_version_snapshot, commission_reason_code, commission_rate_bps,
           commission_flat_amount, commission_amount, status, accrued_date, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lab_test', ?, ?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?)
      `).bind(
        input.tenantId,
        doctorId,
        input.patientId,
        input.visitId,
        input.billId,
        input.labOrderId,
        item.labOrderItemId,
        item.labTestId,
        role,
        item.lineTotal,
        rule.id,
        trackedLegacyRuleVersion(rule),
        'rule_matched',
        rule.rate_type === 'percent' ? rule.rate_value : 0,
        rule.rate_type === 'flat' ? rule.rate_value : 0,
        commissionAmount,
        input.orderDate,
        input.userId,
      ).run();
      if (Number(result.meta?.changes ?? 1) > 0) {
        inserted += 1;
        await recordCommissionAccrualAccountingEvent(db, {
          tenantId: input.tenantId,
          userId: input.userId,
          patientId: input.patientId,
          visitId: input.visitId,
          billId: input.billId,
          accrualDate: input.orderDate,
          accrualId: getAccrualEventSourceId(
            result,
            `lab-order:${input.labOrderId}:${item.labOrderItemId}:${doctorId}`,
          ),
          doctorId,
          sourceType: 'lab_test',
          grossAmount: item.lineTotal,
          amount: commissionAmount,
        });
      }
    }

    return inserted;
  } catch (error) {
    if (isMissingFinanceTableError(error)) return 0;
    throw error;
  }
}

export interface AccrueLabVerificationCommissionsInput {
  tenantId: string | number;
  userId: string | number; // This is the verifier's userId
  patientId: number;
  visitId: number | null;
  billId: number | null;
  labOrderId: number;
  labOrderItemId: number;
  labTestId: number;
  category: string | null;
  lineTotal: number;
  verificationDate: string;
}

/**
 * Accrues commission for the PERFORMER doctor during lab verification.
 */
export async function accrueLabVerificationCommissions(
  db: D1Database,
  input: AccrueLabVerificationCommissionsInput,
): Promise<number> {
  try {
    const commissionEligible = await isLabTestCommissionEligible(db, input.tenantId, input.labTestId);
    if (!commissionEligible) return 0;

    if (input.billId) {
      try {
        const reserved = await db.prepare(`
          SELECT id
          FROM diagnostic_performer_reserves
          WHERE tenant_id = ?
            AND bill_id = ?
            AND lab_test_id = ?
            AND status IN ('reserved', 'paid', 'reversed')
          LIMIT 1
        `).bind(input.tenantId, input.billId, input.labTestId).first<{ id: number }>();
        if (reserved?.id) return 0;
      } catch (error) {
        if (!isMissingPerformerReserveTableError(error)) throw error;
      }
    }

    const doctorId = await getDoctorIdByUserId(db, input.tenantId, input.userId);
    if (!doctorId) return 0;

    const rule = await findDoctorCommissionRule(db, {
      tenantId: input.tenantId,
      doctorId,
      serviceType: 'lab_test',
      incentiveType: 'performer',
      labTestId: input.labTestId,
      category: input.category,
      serviceDate: input.verificationDate,
      commissionEligible,
    });

    if (!rule) return 0;

    const commissionAmount = calculateCommissionAmount({
      grossAmount: input.lineTotal,
      rateType: rule.rate_type,
      rateValue: rule.rate_value,
    });

    if (commissionAmount <= 0) return 0;

    const result = await db.prepare(`
      INSERT OR IGNORE INTO doctor_commission_accruals
        (tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_order_id, lab_order_item_id,
         lab_test_id, source_type, incentive_type, gross_amount, commission_rule_id,
         commission_rule_version_snapshot, commission_reason_code, commission_rate_bps,
         commission_flat_amount, commission_amount, status, accrued_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lab_test', 'performer', ?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?)
    `).bind(
      input.tenantId,
      doctorId,
      input.patientId,
      input.visitId,
      input.billId,
      input.labOrderId,
      input.labOrderItemId,
      input.labTestId,
      input.lineTotal,
      rule.id,
      trackedLegacyRuleVersion(rule),
      'rule_matched',
      rule.rate_type === 'percent' ? rule.rate_value : 0,
      rule.rate_type === 'flat' ? rule.rate_value : 0,
      commissionAmount,
      input.verificationDate,
      input.userId,
    ).run();

    if (Number(result.meta?.changes ?? 1) <= 0) return 0;

    await recordCommissionAccrualAccountingEvent(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      patientId: input.patientId,
      visitId: input.visitId,
      billId: input.billId,
      accrualDate: input.verificationDate,
      accrualId: getAccrualEventSourceId(
        result,
        `lab-verification:${input.labOrderId}:${input.labOrderItemId}:${doctorId}`,
      ),
      doctorId,
      sourceType: 'lab_test',
      grossAmount: input.lineTotal,
      amount: commissionAmount,
    });

    return 1;
  } catch (error) {
    if (isMissingFinanceTableError(error)) return 0;
    throw error;
  }
}

export interface DoctorCommissionWaiverAllocationInput {
  doctorId: number;
  amount: number;
}

export interface AccrueBillCommissionsInput {
  tenantId: string | number;
  userId: string | number;
  patientId: number;
  visitId: number | null;
  billId: number;
  invoiceNo?: string;
  referringDoctorId: number | null;
  billDate: string;
  accruedAtUtc?: string;
  doctorCommissionWaivers?: DoctorCommissionWaiverAllocationInput[];
  items: {
    itemCategory: string;
    description: string | null;
    lineTotal: number;
    grossLineTotal?: number | null;
    taxAmount?: number | null;
    canonicalSourceLineId?: string | null;
    referenceId: number | null;
    billItemId?: number | null;
    performerDoctorId?: number | null;
    prescriberDoctorId?: number | null;
    labTestId?: number | null;
    commissionBaseAmount?: number | null;
    performerReserveAmount?: number | null;
    hasPerformerReserve?: boolean;
  }[];
}

function createDoctorCommissionWaiverConsumer(waivers?: DoctorCommissionWaiverAllocationInput[]) {
  const remainingByDoctor = new Map<number, number>();
  for (const waiver of waivers ?? []) {
    const doctorId = Number(waiver.doctorId);
    const amount = Math.max(0, roundMoney(waiver.amount));
    if (!Number.isFinite(doctorId) || doctorId <= 0 || amount <= 0) continue;
    remainingByDoctor.set(doctorId, roundMoney((remainingByDoctor.get(doctorId) ?? 0) + amount));
  }

  return (input: {
    doctorId: number;
    rule: DoctorCommissionRuleRow;
    commissionBaseAmount: number;
    earnedCommissionAmount: number;
  }) => {
    const remaining = remainingByDoctor.get(input.doctorId) ?? 0;
    const calculation = calculateDoctorCommissionWaiver({
      commissionBaseAmount: input.commissionBaseAmount,
      earnedCommissionAmount: input.earnedCommissionAmount,
      rateType: input.rule.rate_type,
      commissionRateValue: input.rule.rate_value,
      waiverPolicy: input.rule.waiver_policy,
      protectedRateBps: input.rule.protected_rate_bps,
      protectedFlatAmount: input.rule.protected_flat_amount,
      requestedWaiverAmount: remaining,
    });
    if (calculation.doctorWaiverAmount > 0) {
      remainingByDoctor.set(
        input.doctorId,
        roundMoney(Math.max(0, remaining - calculation.doctorWaiverAmount)),
      );
    }
    // Requested/overflow snapshots are accrual-local. The bill discount allocation
    // remains the aggregate source of truth for any hospital-funded remainder.
    return {
      ...calculation,
      requestedWaiverAmount: calculation.doctorWaiverAmount,
      overflowWaiverAmount: 0,
      waiverPolicy: normalizeDoctorCommissionWaiverPolicy(input.rule.waiver_policy),
      protectedRateBps: Math.max(0, Number(input.rule.protected_rate_bps ?? 0)),
      protectedFlatAmount: Math.max(0, roundMoney(input.rule.protected_flat_amount ?? 0)),
    };
  };
}

type CanonicalCommissionRole = 'performing' | 'prescribing' | 'referring';

type BillCommissionAccrualExecutionInput = {
  legacyStatement: D1PreparedStatement;
  legacySourceKey: string;
  canonicalSourceLineId: string | null | undefined;
  invoiceNo: string | undefined;
  accruedAtUtc: string | undefined;
  tenantId: string | number;
  billId: number;
  billDate: string;
  doctorId: number;
  practitionerRole: CanonicalCommissionRole;
  sourceKind: string;
  incentiveType: string;
  legacyInvoiceItemId?: number | null;
  legacyLabOrderItemId?: number | null;
  detailName?: string | null;
  sourceReference?: string | null;
  waiverReason?: string | null;
  rule: DoctorCommissionRuleRow;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  performerReserveAmount: number;
  eligibleBaseAmount: number;
  cumulativeEligibleBaseBeforeAmount?: number;
  earnedAmount: number;
  protectedAmount: number;
  waiverCapacityAmount: number;
  requestedWaiverAmount: number;
  hospitalFundedOverflowAmount: number;
  adjustedAmount: number;
  payableAmount: number;
};

function legacyBatchInserted(result: unknown[]): boolean {
  const first = result[0] as { meta?: { changes?: number } } | undefined;
  return Number(first?.meta?.changes ?? 0) > 0;
}

function canonicalRuleInput(rule: DoctorCommissionRuleRow): LiveDoctorCommissionRuleInput {
  return {
    id: Number(rule.id),
    canonicalSourceKey: rule.canonical_source_key ?? null,
    serviceType: rule.service_type,
    incentiveType: rule.incentive_type,
    labTestId: rule.lab_test_id == null ? null : Number(rule.lab_test_id),
    category: rule.category ?? null,
    rateType: rule.rate_type,
    rateValue: Number(rule.rate_value),
    waiverPolicy: normalizeDoctorCommissionWaiverPolicy(rule.waiver_policy),
    protectedRateValue: rule.rate_type === 'percent'
      ? Math.max(0, Number(rule.protected_rate_bps ?? 0))
      : Math.max(0, roundMoney(rule.protected_flat_amount ?? 0)),
    effectiveFrom: rule.effective_from ?? null,
    effectiveTo: rule.effective_to ?? null,
    isActive: Number(rule.is_active ?? 1) === 1,
    createdAt: rule.created_at ?? null,
    updatedAt: rule.updated_at ?? null,
  };
}

async function loadDoctorCanonicalIdentity(
  db: D1Database,
  tenantId: string | number,
  doctorId: number,
): Promise<DoctorCanonicalIdentityRow | null> {
  return db.prepare(`
    SELECT name,specialty,department,bmdc_reg_no,is_active,user_id,canonical_source_key
    FROM doctors
    WHERE tenant_id=? AND id=?
    LIMIT 1
  `).bind(tenantId, doctorId).first<DoctorCanonicalIdentityRow>();
}

async function executeBillCommissionAccrual(
  db: D1Database,
  input: BillCommissionAccrualExecutionInput,
): Promise<{ applied: boolean; accrualId: number | null }> {
  const supportsCanonicalProjection = Boolean(
    input.invoiceNo
    && input.accruedAtUtc
    && input.canonicalSourceLineId,
  );
  if (!supportsCanonicalProjection) {
    const legacy = await input.legacyStatement.run();
    return {
      applied: Number(legacy.meta?.changes ?? 0) > 0,
      accrualId: Number(legacy.meta?.last_row_id ?? 0) || null,
    };
  }

  const doctor = await loadDoctorCanonicalIdentity(db, input.tenantId, input.doctorId);
  if (!doctor?.name?.trim()) throw new Error('Doctor identity not found for canonical compensation projection');
  const execution = await executeLiveDoctorCommissionAccrual(db, {
    tenantId: String(input.tenantId),
    legacyStatement: input.legacyStatement,
    legacyAccrualSourceKey: input.legacySourceKey,
    billId: input.billId,
    invoiceNo: input.invoiceNo!,
    invoiceSourceLineId: input.canonicalSourceLineId!,
    doctorId: input.doctorId,
    doctorCanonicalSourceKey: doctor.canonical_source_key,
    doctorDisplayName: doctor.name.trim(),
    doctorSpecialty: doctor.specialty,
    doctorDepartment: doctor.department,
    doctorRegistrationNumber: doctor.bmdc_reg_no,
    doctorUserId: doctor.user_id,
    doctorIsActive: Number(doctor.is_active ?? 1) === 1,
    practitionerKind: doctor.user_id == null ? 'external' : 'internal',
    practitionerRole: input.practitionerRole,
    rule: canonicalRuleInput(input.rule),
    grossAmount: input.grossAmount,
    discountAmount: input.discountAmount,
    taxAmount: input.taxAmount,
    performerReserveAmount: input.performerReserveAmount,
    eligibleBaseAmount: input.eligibleBaseAmount,
    cumulativeEligibleBaseBeforeAmount: input.cumulativeEligibleBaseBeforeAmount,
    earnedAmount: input.earnedAmount,
    protectedAmount: input.protectedAmount,
    waiverCapacityAmount: input.waiverCapacityAmount,
    requestedWaiverAmount: input.requestedWaiverAmount,
    hospitalFundedOverflowAmount: input.hospitalFundedOverflowAmount,
    adjustedAmount: input.adjustedAmount,
    payableAmount: input.payableAmount,
    accruedAtUtc: input.accruedAtUtc!,
    businessDate: input.billDate,
    reportingContext: {
      sourceKind: input.sourceKind,
      incentiveType: input.incentiveType,
      legacyInvoiceItemId: input.legacyInvoiceItemId ?? null,
      legacyLabOrderItemId: input.legacyLabOrderItemId ?? null,
      detailName: input.detailName ?? null,
      sourceReference: input.sourceReference ?? input.invoiceNo ?? null,
      waiverReason: input.waiverReason ?? null,
    },
  });

  let applied = false;
  if (execution.mode === 'legacy') applied = legacyBatchInserted(execution.result);
  else if (execution.mode === 'strict') applied = execution.result.status === 'applied';
  else if (execution.canonicalSucceeded) applied = execution.canonicalResult.status === 'applied';
  else applied = legacyBatchInserted(execution.result);

  const accrual = await db.prepare(`
    SELECT id
    FROM doctor_commission_accruals
    WHERE tenant_id=? AND canonical_source_key=?
    LIMIT 1
  `).bind(input.tenantId, input.legacySourceKey).first<{ id: number }>();
  return { applied, accrualId: accrual?.id ? Number(accrual.id) : null };
}

export async function accrueBillCommissions(
  db: D1Database,
  input: AccrueBillCommissionsInput,
): Promise<number> {
  if (input.items.length === 0) return 0;

  try {
    let inserted = 0;
    const commissionEligibility = await loadLabTestCommissionEligibility(
      db,
      input.tenantId,
      input.items.map((item) => item.labTestId),
    );
    const consumeDoctorWaiver = createDoctorCommissionWaiverConsumer(input.doctorCommissionWaivers);
    const allocateCommissionAmount = createCumulativeCommissionAllocator();
    const hasDoctorVisitItems = input.items.some((item) => item.itemCategory === 'doctor_visit');
    const visitDoctorId = input.visitId && hasDoctorVisitItems
      ? await getVisitDoctorId(db, input.tenantId, input.visitId)
      : null;

    for (const [itemIndex, item] of input.items.entries()) {
      const labTestId = Number(item.labTestId ?? 0);
      const commissionEligible = !Number.isInteger(labTestId) || labTestId <= 0
        ? true
        : (commissionEligibility.get(labTestId) ?? true);
      if (!commissionEligible) continue;
      const netCommissionBaseAmount = Math.max(0, roundMoney(item.commissionBaseAmount ?? item.lineTotal));
      const performerReserveAmount = Math.max(0, roundMoney(item.performerReserveAmount ?? 0));
      const grossLineTotal = Math.max(
        Math.max(0, roundMoney(item.lineTotal)),
        Math.max(0, roundMoney(item.grossLineTotal ?? item.lineTotal)),
      );

      // 1. Handle line-level ordering/prescribing doctor commissions.
      // The bill-level referring doctor is the default prescriber for lines that
      // do not carry their own prescriberDoctorId.
      const prescriberDoctorId = item.prescriberDoctorId && Number(item.prescriberDoctorId) > 0
        ? Number(item.prescriberDoctorId)
        : input.referringDoctorId;
      if (prescriberDoctorId) {
        const diagnosticItem = isDiagnosticCommissionItem(item.itemCategory);
        const commissionGrossAmount = diagnosticItem
          ? grossLineTotal
          : Math.max(0, roundMoney(item.lineTotal));
        const commissionBaseAmount = diagnosticItem
          ? (item.commissionBaseAmount != null
              ? netCommissionBaseAmount
              : roundMoney(Math.max(0, netCommissionBaseAmount - performerReserveAmount)))
          : netCommissionBaseAmount;
        const primaryRule = diagnosticItem
          ? await findDoctorCommissionRule(db, {
              tenantId: input.tenantId,
              doctorId: prescriberDoctorId,
              serviceType: 'lab_test',
              incentiveType: 'prescriber',
              labTestId: item.labTestId || null,
              category: item.itemCategory,
              serviceDate: input.billDate,
              commissionEligible,
            })
          : null;
        const fallbackRule = primaryRule ? null : await findDoctorCommissionRule(db, {
          tenantId: input.tenantId,
          doctorId: prescriberDoctorId,
          serviceType: 'referral',
          incentiveType: 'referrer',
          labTestId: item.labTestId || null,
          category: item.itemCategory,
          serviceDate: input.billDate,
          commissionEligible,
        });
        const referralRule = primaryRule ?? fallbackRule;
        const sourceType = primaryRule ? 'lab_test' : 'referral';
        const incentiveType = primaryRule ? 'prescriber' : 'referrer';

        if (referralRule) {
          const commissionAllocation = allocateCommissionAmount({
            allocationKey: [prescriberDoctorId, sourceType, incentiveType, referralRule.id].join(':'),
            grossAmount: commissionBaseAmount,
            rateType: referralRule.rate_type,
            rateValue: referralRule.rate_value,
          });
          const commissionAmount = commissionAllocation.amount;

          if (commissionAmount > 0) {
            const waiver = consumeDoctorWaiver({
              doctorId: prescriberDoctorId,
              rule: referralRule,
              commissionBaseAmount,
              earnedCommissionAmount: commissionAmount,
            });

            const practitionerRole: CanonicalCommissionRole = primaryRule ? 'prescribing' : 'referring';
            const sourceLineId = item.canonicalSourceLineId
              ?? `${itemIndex + 1}:${item.itemCategory}:${item.referenceId ?? 'none'}`;
            const legacySourceKey = `bill:${input.billId}:line:${sourceLineId}:doctor:${prescriberDoctorId}:rule:${referralRule.id}:${practitionerRole}`;
            const notes = `${sourceType === 'lab_test' ? 'Diagnostic/test prescriber' : 'Referral'} commission for ${item.itemCategory}: ${item.description || ''}`;
            const legacyStatement = db.prepare(`
              INSERT OR IGNORE INTO doctor_commission_accruals
                (tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id, canonical_source_key,
                 source_type, incentive_type, gross_amount, commission_base_amount, performer_reserve_amount,
                 commission_rule_id, commission_rule_version_snapshot, commission_reason_code,
                 commission_rate_bps, commission_flat_amount, commission_amount,
                 earned_commission_amount, waiver_policy_snapshot, protected_rate_bps_snapshot,
                 protected_flat_amount_snapshot, protected_commission_amount, maximum_waiver_amount,
                 requested_waiver_amount, hospital_funded_overflow_amount,
                 doctor_waiver_amount, payable_commission_amount, balance_amount,
                 status, accrued_date, created_by, notes)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM doctor_commission_accruals existing
                WHERE existing.tenant_id = ?
                  AND existing.canonical_source_key = ?
              )
            `).bind(
              input.tenantId,
              prescriberDoctorId,
              input.patientId,
              input.visitId,
              input.billId,
              item.labTestId || null,
              legacySourceKey,
              sourceType,
              incentiveType,
              commissionGrossAmount,
              commissionBaseAmount,
              performerReserveAmount,
              referralRule.id,
              trackedLegacyRuleVersion(referralRule),
              commissionReasonForAccrual({
                commissionBaseAmount,
                earnedAmount: waiver.earnedCommissionAmount,
                waiverAmount: waiver.doctorWaiverAmount,
                payableAmount: waiver.payableCommissionAmount,
              }),
              referralRule.rate_type === 'percent' ? referralRule.rate_value : 0,
              referralRule.rate_type === 'flat' ? referralRule.rate_value : 0,
              waiver.payableCommissionAmount,
              waiver.earnedCommissionAmount,
              waiver.waiverPolicy,
              waiver.protectedRateBps,
              waiver.protectedFlatAmount,
              waiver.protectedCommissionAmount,
              waiver.maximumWaiverAmount,
              waiver.requestedWaiverAmount,
              waiver.overflowWaiverAmount,
              waiver.doctorWaiverAmount,
              waiver.payableCommissionAmount,
              waiver.payableCommissionAmount,
              input.billDate,
              input.userId,
              notes,
              input.tenantId,
              legacySourceKey,
            );
            const execution = await executeBillCommissionAccrual(db, {
              legacyStatement,
              legacySourceKey,
              canonicalSourceLineId: item.canonicalSourceLineId,
              invoiceNo: input.invoiceNo,
              accruedAtUtc: input.accruedAtUtc,
              tenantId: input.tenantId,
              billId: input.billId,
              billDate: input.billDate,
              doctorId: prescriberDoctorId,
              practitionerRole,
              sourceKind: sourceType,
              incentiveType,
              legacyInvoiceItemId: item.billItemId ?? null,
              detailName: item.description,
              sourceReference: input.invoiceNo ?? null,
              waiverReason: waiver.doctorWaiverAmount > 0 ? 'patient_discount_allocation' : null,
              rule: referralRule,
              grossAmount: grossLineTotal,
              discountAmount: Math.max(0, roundMoney(grossLineTotal - item.lineTotal)),
              taxAmount: Math.max(0, roundMoney(item.taxAmount ?? 0)),
              performerReserveAmount,
              eligibleBaseAmount: commissionBaseAmount,
              cumulativeEligibleBaseBeforeAmount: commissionAllocation.cumulativeBaseBefore,
              earnedAmount: waiver.earnedCommissionAmount,
              protectedAmount: waiver.protectedCommissionAmount,
              waiverCapacityAmount: waiver.maximumWaiverAmount,
              requestedWaiverAmount: waiver.requestedWaiverAmount,
              hospitalFundedOverflowAmount: waiver.overflowWaiverAmount,
              adjustedAmount: waiver.doctorWaiverAmount,
              payableAmount: waiver.payableCommissionAmount,
            });
            if (execution.applied) {
              inserted += 1;
              if (waiver.payableCommissionAmount > 0) {
                await recordCommissionAccrualAccountingEvent(db, {
                  tenantId: input.tenantId,
                  userId: input.userId,
                  patientId: input.patientId,
                  visitId: input.visitId,
                  billId: input.billId,
                  accrualDate: input.billDate,
                  accrualId: execution.accrualId ?? `bill:${input.billId}:${sourceType}:${prescriberDoctorId}:${inserted}`,
                  doctorId: prescriberDoctorId,
                  sourceType,
                  grossAmount: commissionGrossAmount,
                  amount: waiver.payableCommissionAmount,
                });
              }
            }
          }
        }
      }



      // 2. Handle line-level performer doctor commissions for diagnostic/imaging services.
      // Reception F2 and patient-flow service bills can select the doctor who actually
      // performed an ultrasound/diagnostic test. That performer must get a separate
      // payable from the prescribing/referring doctor.
      const performerDoctorId = item.performerDoctorId && Number(item.performerDoctorId) > 0
        ? Number(item.performerDoctorId)
        : null;
      const performerDiagnosticItem = isDiagnosticCommissionItem(item.itemCategory);
      if (!item.hasPerformerReserve && performerDoctorId && performerDiagnosticItem) {
        const performerRule = await findDoctorCommissionRule(db, {
          tenantId: input.tenantId,
          doctorId: performerDoctorId,
          serviceType: 'lab_test',
          incentiveType: 'performer',
          labTestId: item.labTestId ?? null,
          category: item.itemCategory,
          serviceDate: input.billDate,
          commissionEligible,
        });

        if (performerRule) {
          const commissionAllocation = allocateCommissionAmount({
            allocationKey: [performerDoctorId, 'lab_test', 'performer', performerRule.id].join(':'),
            grossAmount: item.lineTotal,
            rateType: performerRule.rate_type,
            rateValue: performerRule.rate_value,
          });
          const commissionAmount = commissionAllocation.amount;

          if (commissionAmount > 0) {
            const waiver = consumeDoctorWaiver({
              doctorId: performerDoctorId,
              rule: performerRule,
              commissionBaseAmount: item.lineTotal,
              earnedCommissionAmount: commissionAmount,
            });
            if (waiver.earnedCommissionAmount > 0) {
              const notes = `Diagnostic/test performer commission for ${item.itemCategory}: ${item.description || ''}`;
              const sourceLineId = item.canonicalSourceLineId
                ?? `${itemIndex + 1}:${item.itemCategory}:${item.referenceId ?? 'none'}`;
              const legacySourceKey = `bill:${input.billId}:line:${sourceLineId}:doctor:${performerDoctorId}:rule:${performerRule.id}:performing`;
              const legacyStatement = db.prepare(`
                INSERT OR IGNORE INTO doctor_commission_accruals
                  (tenant_id, doctor_id, patient_id, visit_id, bill_id, lab_test_id, canonical_source_key,
                   source_type, incentive_type, gross_amount, commission_base_amount, performer_reserve_amount,
                   commission_rule_id, commission_rule_version_snapshot, commission_reason_code,
                   commission_rate_bps, commission_flat_amount, commission_amount,
                   earned_commission_amount, waiver_policy_snapshot, protected_rate_bps_snapshot,
                   protected_flat_amount_snapshot, protected_commission_amount, maximum_waiver_amount,
                   requested_waiver_amount, hospital_funded_overflow_amount,
                   doctor_waiver_amount, payable_commission_amount, balance_amount,
                   status, accrued_date, created_by, notes)
                SELECT ?, ?, ?, ?, ?, ?, ?, 'lab_test', 'performer', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?, ?
                WHERE NOT EXISTS (
                  SELECT 1 FROM doctor_commission_accruals existing
                  WHERE existing.tenant_id = ?
                    AND existing.canonical_source_key = ?
                )
              `).bind(
                input.tenantId,
                performerDoctorId,
                input.patientId,
                input.visitId,
                input.billId,
                item.labTestId ?? null,
                legacySourceKey,
                item.lineTotal,
                item.lineTotal,
                performerRule.id,
                trackedLegacyRuleVersion(performerRule),
                commissionReasonForAccrual({
                  commissionBaseAmount: item.lineTotal,
                  earnedAmount: waiver.earnedCommissionAmount,
                  waiverAmount: waiver.doctorWaiverAmount,
                  payableAmount: waiver.payableCommissionAmount,
                }),
                performerRule.rate_type === 'percent' ? performerRule.rate_value : 0,
                performerRule.rate_type === 'flat' ? performerRule.rate_value : 0,
                waiver.payableCommissionAmount,
                waiver.earnedCommissionAmount,
                waiver.waiverPolicy,
                waiver.protectedRateBps,
                waiver.protectedFlatAmount,
                waiver.protectedCommissionAmount,
                waiver.maximumWaiverAmount,
                waiver.requestedWaiverAmount,
                waiver.overflowWaiverAmount,
                waiver.doctorWaiverAmount,
                waiver.payableCommissionAmount,
                waiver.payableCommissionAmount,
                input.billDate,
                input.userId,
                notes,
                input.tenantId,
                legacySourceKey,
              );
              const execution = await executeBillCommissionAccrual(db, {
                legacyStatement,
                legacySourceKey,
                canonicalSourceLineId: item.canonicalSourceLineId,
                invoiceNo: input.invoiceNo,
                accruedAtUtc: input.accruedAtUtc,
                tenantId: input.tenantId,
                billId: input.billId,
                billDate: input.billDate,
                doctorId: performerDoctorId,
                practitionerRole: 'performing',
                sourceKind: 'lab_test',
                incentiveType: 'performer',
                legacyInvoiceItemId: item.billItemId ?? null,
                detailName: item.description,
                sourceReference: input.invoiceNo ?? null,
                waiverReason: waiver.doctorWaiverAmount > 0 ? 'patient_discount_allocation' : null,
                rule: performerRule,
                grossAmount: grossLineTotal,
                discountAmount: Math.max(0, roundMoney(grossLineTotal - item.lineTotal)),
                taxAmount: Math.max(0, roundMoney(item.taxAmount ?? 0)),
                performerReserveAmount: 0,
                eligibleBaseAmount: item.lineTotal,
                cumulativeEligibleBaseBeforeAmount: commissionAllocation.cumulativeBaseBefore,
                earnedAmount: waiver.earnedCommissionAmount,
                protectedAmount: waiver.protectedCommissionAmount,
                waiverCapacityAmount: waiver.maximumWaiverAmount,
                requestedWaiverAmount: waiver.requestedWaiverAmount,
                hospitalFundedOverflowAmount: waiver.overflowWaiverAmount,
                adjustedAmount: waiver.doctorWaiverAmount,
                payableAmount: waiver.payableCommissionAmount,
              });
              if (execution.applied) {
                inserted += 1;
                if (waiver.payableCommissionAmount > 0) {
                  await recordCommissionAccrualAccountingEvent(db, {
                    tenantId: input.tenantId,
                    userId: input.userId,
                    patientId: input.patientId,
                    visitId: input.visitId,
                    billId: input.billId,
                    accrualDate: input.billDate,
                    accrualId: execution.accrualId ?? `bill:${input.billId}:performer:${performerDoctorId}:${inserted}`,
                    doctorId: performerDoctorId,
                    sourceType: 'lab_test',
                    grossAmount: item.lineTotal,
                    amount: waiver.payableCommissionAmount,
                  });
                }
              }
            }
          }
        }
      }

      // 3. Handle Visit/appointment doctor consultation commissions (as Performer).
      // Appointment invoices can be paid before visit creation, so fall back to
      // the immutable invoice item reference doctor when no visit doctor exists.
      const itemDoctorId = item.referenceId && Number(item.referenceId) > 0
        ? Number(item.referenceId)
        : null;
      const consultationDoctorId = visitDoctorId ?? itemDoctorId;
      if (consultationDoctorId && item.itemCategory === 'doctor_visit') {
        const consultRule = await findDoctorCommissionRule(db, {
          tenantId: input.tenantId,
          doctorId: consultationDoctorId,
          serviceType: 'consultation_fee',
          incentiveType: 'performer',
          serviceDate: input.billDate,
        });

        if (consultRule) {
          const commissionAllocation = allocateCommissionAmount({
            allocationKey: [consultationDoctorId, 'consultation_fee', 'performer', consultRule.id].join(':'),
            grossAmount: item.lineTotal,
            rateType: consultRule.rate_type,
            rateValue: consultRule.rate_value,
          });
          const commissionAmount = capConsultationCommissionAtCollectedAmount(item.lineTotal, commissionAllocation.amount);

          if (commissionAmount > 0) {
            const waiver = consumeDoctorWaiver({
              doctorId: consultationDoctorId,
              rule: consultRule,
              commissionBaseAmount: item.lineTotal,
              earnedCommissionAmount: commissionAmount,
            });
            if (waiver.earnedCommissionAmount <= 0) continue;

            const sourceLineId = item.canonicalSourceLineId
              ?? `${itemIndex + 1}:${item.itemCategory}:${item.referenceId ?? 'none'}`;
            const legacySourceKey = `bill:${input.billId}:line:${sourceLineId}:doctor:${consultationDoctorId}:rule:${consultRule.id}:performing`;
            const legacyStatement = db.prepare(`
              INSERT OR IGNORE INTO doctor_commission_accruals
                (tenant_id, doctor_id, patient_id, visit_id, bill_id, canonical_source_key,
                 source_type, incentive_type, gross_amount, commission_base_amount, performer_reserve_amount,
                 commission_rule_id, commission_rule_version_snapshot, commission_reason_code,
                 commission_rate_bps, commission_flat_amount, commission_amount,
                 earned_commission_amount, waiver_policy_snapshot, protected_rate_bps_snapshot,
                 protected_flat_amount_snapshot, protected_commission_amount, maximum_waiver_amount,
                 requested_waiver_amount, hospital_funded_overflow_amount,
                 doctor_waiver_amount, payable_commission_amount, balance_amount,
                 status, accrued_date, created_by)
              SELECT ?, ?, ?, ?, ?, ?, 'consultation_fee', 'performer', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM doctor_commission_accruals existing
                WHERE existing.tenant_id=? AND existing.canonical_source_key=?
              )
            `).bind(
              input.tenantId,
              consultationDoctorId,
              input.patientId,
              input.visitId,
              input.billId,
              legacySourceKey,
              grossLineTotal,
              item.lineTotal,
              consultRule.id,
              trackedLegacyRuleVersion(consultRule),
              commissionReasonForAccrual({
                commissionBaseAmount: item.lineTotal,
                earnedAmount: waiver.earnedCommissionAmount,
                waiverAmount: waiver.doctorWaiverAmount,
                payableAmount: waiver.payableCommissionAmount,
              }),
              consultRule.rate_type === 'percent' ? consultRule.rate_value : 0,
              consultRule.rate_type === 'flat' ? consultRule.rate_value : 0,
              waiver.payableCommissionAmount,
              waiver.earnedCommissionAmount,
              waiver.waiverPolicy,
              waiver.protectedRateBps,
              waiver.protectedFlatAmount,
              waiver.protectedCommissionAmount,
              waiver.maximumWaiverAmount,
              waiver.requestedWaiverAmount,
              waiver.overflowWaiverAmount,
              waiver.doctorWaiverAmount,
              waiver.payableCommissionAmount,
              waiver.payableCommissionAmount,
              input.billDate,
              input.userId,
              input.tenantId,
              legacySourceKey,
            );
            const execution = await executeBillCommissionAccrual(db, {
              legacyStatement,
              legacySourceKey,
              canonicalSourceLineId: item.canonicalSourceLineId,
              invoiceNo: input.invoiceNo,
              accruedAtUtc: input.accruedAtUtc,
              tenantId: input.tenantId,
              billId: input.billId,
              billDate: input.billDate,
              doctorId: consultationDoctorId,
              practitionerRole: 'performing',
              sourceKind: 'consultation_fee',
              incentiveType: 'performer',
              legacyInvoiceItemId: item.billItemId ?? null,
              detailName: item.description,
              sourceReference: input.invoiceNo ?? null,
              waiverReason: waiver.doctorWaiverAmount > 0 ? 'patient_discount_allocation' : null,
              rule: consultRule,
              grossAmount: grossLineTotal,
              discountAmount: Math.max(0, roundMoney(grossLineTotal - item.lineTotal)),
              taxAmount: Math.max(0, roundMoney(item.taxAmount ?? 0)),
              performerReserveAmount: 0,
              eligibleBaseAmount: item.lineTotal,
              cumulativeEligibleBaseBeforeAmount: commissionAllocation.cumulativeBaseBefore,
              earnedAmount: waiver.earnedCommissionAmount,
              protectedAmount: waiver.protectedCommissionAmount,
              waiverCapacityAmount: waiver.maximumWaiverAmount,
              requestedWaiverAmount: waiver.requestedWaiverAmount,
              hospitalFundedOverflowAmount: waiver.overflowWaiverAmount,
              adjustedAmount: waiver.doctorWaiverAmount,
              payableAmount: waiver.payableCommissionAmount,
            });
            if (execution.applied) {
              inserted += 1;
              if (waiver.payableCommissionAmount > 0) {
                await recordCommissionAccrualAccountingEvent(db, {
                  tenantId: input.tenantId,
                  userId: input.userId,
                  patientId: input.patientId,
                  visitId: input.visitId,
                  billId: input.billId,
                  accrualDate: input.billDate,
                  accrualId: execution.accrualId ?? `bill:${input.billId}:consultation:${consultationDoctorId}:${inserted}`,
                  doctorId: consultationDoctorId,
                  sourceType: 'consultation_fee',
                  grossAmount: item.lineTotal,
                  amount: waiver.payableCommissionAmount,
                });
              }
            }
          }
        }
      }
    }

    return inserted;
  } catch (error) {
    if (isMissingFinanceTableError(error)) return 0;
    throw error;
  }
}

export interface BillCommissionSummary {
  totalCommissions: number;
  byCategory: Record<string, number>;
}

/**
 * Retrieves a summary of accrued commissions for a specific bill, grouped by source category.
 * Useful for calculating net hospital income by subtracting doctor shares.
 */
export async function getBillCommissionSummary(
  db: D1Database,
  tenantId: string | number,
  billId: number,
): Promise<BillCommissionSummary> {
  try {
    const rows = await db.prepare(`
      SELECT source_type, SUM(commission_amount) as total
      FROM doctor_commission_accruals
      WHERE tenant_id = ? AND bill_id = ?
      GROUP BY source_type
    `).bind(tenantId, billId).all<{ source_type: string; total: number }>();

    const summary: BillCommissionSummary = {
      totalCommissions: 0,
      byCategory: {},
    };

    if (rows.results) {
      for (const row of rows.results) {
        summary.totalCommissions += row.total;
        summary.byCategory[row.source_type] = row.total;
      }
    }

    return summary;
  } catch (error) {
    if (isMissingFinanceTableError(error)) {
      return { totalCommissions: 0, byCategory: {} };
    }
    throw error;
  }
}
/**
 * Marks all accrued commissions for a specific bill as 'cancelled'.
 * Should be called when an entire bill is cancelled.
 */
export async function cancelBillCommissions(
  db: D1Database,
  tenantId: string | number,
  billId: number,
  reason: string,
  userId: string | number = 'system',
): Promise<number> {
  try {
    const rows = await db.prepare(`
      SELECT id, doctor_id, patient_id, visit_id, bill_id, source_type, gross_amount,
             commission_amount, accrued_date
      FROM doctor_commission_accruals
      WHERE tenant_id = ? AND bill_id = ? AND status = 'accrued'
    `).bind(tenantId, billId).all<{
      id: number;
      doctor_id: number;
      patient_id: number | null;
      visit_id: number | null;
      bill_id: number | null;
      source_type: string;
      gross_amount: number;
      commission_amount: number;
      accrued_date: string;
    }>();

    const result = await db.prepare(`
      UPDATE doctor_commission_accruals
      SET status = 'cancelled',
          notes = COALESCE(notes, '') || ' | Cancelled: ' || ?
      WHERE tenant_id = ? AND bill_id = ? AND status = 'accrued'
    `).bind(reason, tenantId, billId).run();

    for (const row of rows.results ?? []) {
      await recordCommissionCancellationAccountingEvent(db, {
        tenantId,
        userId,
        patientId: row.patient_id,
        visitId: row.visit_id,
        billId: row.bill_id,
        accrualId: row.id,
        doctorId: row.doctor_id,
        sourceType: row.source_type,
        grossAmount: row.gross_amount,
        amount: row.commission_amount,
        cancellationDate: getTodayGMT6(),
        reason,
      });
    }

    return result.meta.changes;
  } catch (error) {
    if (isMissingFinanceTableError(error)) return 0;
    throw error;
  }
}

/**
 * Marks commissions for specific invoice items as 'cancelled'.
 * Used when individual items are cancelled from a bill.
 */
export async function cancelLabItemCommissions(
  db: D1Database,
  tenantId: string | number,
  billId: number,
  labOrderItemIds: number[],
  reason: string,
  userId: string | number = 'system',
): Promise<number> {
  const ids = Array.from(new Set(labOrderItemIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return 0;

  try {
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.prepare(`
      SELECT id, doctor_id, patient_id, visit_id, bill_id, source_type, gross_amount,
             commission_amount, accrued_date
      FROM doctor_commission_accruals
      WHERE tenant_id = ?
        AND bill_id = ?
        AND source_type = 'lab_test'
        AND lab_order_item_id IN (${placeholders})
        AND status = 'accrued'
    `).bind(tenantId, billId, ...ids).all<{
      id: number;
      doctor_id: number;
      patient_id: number | null;
      visit_id: number | null;
      bill_id: number | null;
      source_type: string;
      gross_amount: number;
      commission_amount: number;
      accrued_date: string;
    }>();

    const result = await db.prepare(`
      UPDATE doctor_commission_accruals
      SET status = 'cancelled',
          notes = COALESCE(notes, '') || ' | Refunded Lab Item: ' || ?
      WHERE tenant_id = ?
        AND bill_id = ?
        AND source_type = 'lab_test'
        AND lab_order_item_id IN (${placeholders})
        AND status = 'accrued'
    `).bind(reason, tenantId, billId, ...ids).run();

    for (const row of rows.results ?? []) {
      await recordCommissionCancellationAccountingEvent(db, {
        tenantId,
        userId,
        patientId: row.patient_id,
        visitId: row.visit_id,
        billId: row.bill_id,
        accrualId: row.id,
        doctorId: row.doctor_id,
        sourceType: row.source_type,
        grossAmount: row.gross_amount,
        amount: row.commission_amount,
        cancellationDate: getTodayGMT6(),
        reason,
      });
    }

    return result.meta.changes;
  } catch (error) {
    if (isMissingFinanceTableError(error)) return 0;
    throw error;
  }
}

export async function cancelItemCommissions(
  db: D1Database,
  tenantId: string | number,
  billId: number,
  itemCategories: string[],
  reason: string,
  userId: string | number = 'system',
): Promise<number> {
  if (itemCategories.length === 0) return 0;

  try {
    return await cancelDoctorCommissionAccrualsWithCanonicalAdjustment(
      db as D1Database & import('./canonical/command-batch').CanonicalBatchDatabase,
      {
        tenantId: String(tenantId),
        billId,
        sourceTypes: itemCategories,
        reason,
        userId,
        cancelledAtUtc: new Date().toISOString(),
        businessDate: getTodayGMT6(),
      },
    );
  } catch (error) {
    if (isMissingFinanceTableError(error)) return 0;
    throw error;
  }
}

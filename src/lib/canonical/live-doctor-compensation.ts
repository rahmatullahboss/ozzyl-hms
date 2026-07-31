import type { DecimalAmount } from './money';
import { toMinorUnits } from './money';
import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from './command-batch';
import type { CompensationRole } from './commands/accrue-compensation';
import type { DoctorCommissionWaiverPolicy } from '../doctor-commission-waiver-policy';
import {
  buildCanonicalCompensationReportingContextStatement,
  type CanonicalCompensationReportingContextInput,
} from './compensation-reporting-context';
import { resolveLegacyLiveInvoiceLineAuthority } from './legacy-live-invoice-line-authority';
import { executeStrictFinancialMutation, type FinancialMutationExecution } from './strict-financial-mutation';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from './source-mapping';
import { toUtcIso } from './time';

const PRACTITIONER_SOURCE_TYPE = 'legacy_doctor';
const RULE_SOURCE_TYPE = 'legacy_doctor_commission_rule';
const ACCRUAL_SOURCE_TYPE = 'legacy_doctor_commission_accrual';

export interface LiveDoctorCommissionRuleInput {
  id: number;
  canonicalSourceKey?: string | null;
  serviceType: 'lab_test' | 'consultation_fee' | 'referral';
  incentiveType: 'performer' | 'prescriber' | 'referrer';
  labTestId: number | null;
  category: string | null;
  rateType: 'percent' | 'flat';
  rateValue: number;
  waiverPolicy?: DoctorCommissionWaiverPolicy;
  protectedRateValue?: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LiveDoctorCommissionAccrualInput {
  tenantId: string;
  legacyStatement: CanonicalPreparedStatement;
  legacyAccrualSourceKey: string;
  billId: number;
  invoiceNo: string;
  invoiceSourceLineId: string;
  doctorId: number;
  doctorCanonicalSourceKey?: string | null;
  doctorDisplayName: string;
  doctorSpecialty?: string | null;
  doctorDepartment?: string | null;
  doctorRegistrationNumber?: string | null;
  doctorUserId?: number | null;
  doctorIsActive: boolean;
  practitionerKind?: 'internal' | 'external';
  practitionerRole: CompensationRole;
  rule: LiveDoctorCommissionRuleInput;
  grossAmount: DecimalAmount;
  discountAmount: DecimalAmount;
  taxAmount: DecimalAmount;
  performerReserveAmount: DecimalAmount;
  eligibleBaseAmount: DecimalAmount;
  cumulativeEligibleBaseBeforeAmount?: DecimalAmount;
  earnedAmount: DecimalAmount;
  protectedAmount?: DecimalAmount;
  waiverCapacityAmount?: DecimalAmount;
  requestedWaiverAmount?: DecimalAmount;
  hospitalFundedOverflowAmount?: DecimalAmount;
  adjustedAmount: DecimalAmount;
  payableAmount: DecimalAmount;
  accruedAtUtc: string;
  businessDate: string;
  reportingContext?: CanonicalCompensationReportingContextInput;
}

export interface LiveDoctorCommissionCanonicalResult {
  accrualPublicId: string;
  practitionerPublicId: string;
  rulePublicId: string;
  ruleVersion: number;
  invoicePublicId: string;
  invoiceLinePublicId: string;
  grossMinor: number;
  discountMinor: number;
  performerReserveMinor: number;
  eligibleBaseMinor: number;
  earnedMinor: number;
  protectedMinor: number;
  waiverCapacityMinor: number;
  requestedWaiverMinor: number;
  hospitalFundedOverflowMinor: number;
  adjustedMinor: number;
  payableMinor: number;
  status: 'accrued' | 'settled';
}

type LiveDoctorCommissionExecution = FinancialMutationExecution<CanonicalCommandResult<LiveDoctorCommissionCanonicalResult>>;

interface ExistingCanonicalRuleRow {
  rule_version: number;
  source_evidence_sha256: string;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function validBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function normalizedCategory(value: string | null): string | null {
  const normalized = value?.normalize('NFKC').trim().toLocaleLowerCase('en-US') ?? '';
  return normalized || null;
}

function expectedRole(incentiveType: LiveDoctorCommissionRuleInput['incentiveType']): CompensationRole {
  if (incentiveType === 'performer') return 'performing';
  if (incentiveType === 'prescriber') return 'prescribing';
  return 'referring';
}

function canonicalRate(rule: LiveDoctorCommissionRuleInput): { rateType: 'fixed' | 'basis_points'; rateValue: number } {
  if (rule.rateType === 'percent') {
    if (!Number.isSafeInteger(rule.rateValue) || rule.rateValue < 0 || rule.rateValue > 10_000) {
      throw new RangeError('Percentage commission rate must be basis points between 0 and 10000');
    }
    return { rateType: 'basis_points', rateValue: rule.rateValue };
  }
  return { rateType: 'fixed', rateValue: Number(toMinorUnits(rule.rateValue)) };
}

function canonicalWaiverPolicy(
  rule: LiveDoctorCommissionRuleInput,
  rate: { rateType: 'fixed' | 'basis_points'; rateValue: number },
): { waiverPolicy: DoctorCommissionWaiverPolicy; protectedRateValue: number } {
  const waiverPolicy = rule.waiverPolicy ?? 'full_earned';
  let protectedRateValue = 0;
  if (waiverPolicy === 'no_doctor_waiver') {
    protectedRateValue = rate.rateValue;
  } else if (waiverPolicy === 'protected_floor') {
    protectedRateValue = rule.rateType === 'percent'
      ? Math.max(0, Math.round(Number(rule.protectedRateValue ?? 0)))
      : Number(toMinorUnits(rule.protectedRateValue ?? 0));
  }
  if (!Number.isSafeInteger(protectedRateValue) || protectedRateValue < 0 || protectedRateValue > rate.rateValue) {
    throw new RangeError('Protected commission rule value must be between zero and the commission rate');
  }
  return { waiverPolicy, protectedRateValue };
}

function calculatedPercentageMinor(baseMinor: number, rateValue: number): number {
  const value = (BigInt(baseMinor) * BigInt(rateValue) + 5000n) / 10_000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Calculated commission exceeds safe integer range');
  }
  return Number(value);
}

function calculatedEarnedMinor(
  eligibleBaseMinor: number,
  rate: { rateType: 'fixed' | 'basis_points'; rateValue: number },
  cumulativeEligibleBaseBeforeMinor = 0,
): number {
  if (rate.rateType === 'fixed') return rate.rateValue;
  const previousAmount = calculatedPercentageMinor(cumulativeEligibleBaseBeforeMinor, rate.rateValue);
  const nextAmount = calculatedPercentageMinor(cumulativeEligibleBaseBeforeMinor + eligibleBaseMinor, rate.rateValue);
  return nextAmount - previousAmount;
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: string;
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
    ON CONFLICT(tenant_id,entity_type,source_type,source_public_id) DO UPDATE SET
      canonical_public_id=excluded.canonical_public_id,
      source_table=excluded.source_table,
      mapping_status='mapped',
      mapping_version=canonical_source_mappings.mapping_version+1,
      evidence_sha256=excluded.evidence_sha256,
      updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.evidenceSha256,
  );
}

async function mappedPractitionerPublicId(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourcePublicId: string,
): Promise<string | null> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='practitioner'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, PRACTITIONER_SOURCE_TYPE, sourcePublicId).first<MappingRow>();
  if (!mapping) return null;
  if (mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('Canonical practitioner source mapping is not active and exact');
  }
  return mapping.canonical_public_id;
}

async function mappedServicePublicId(
  db: CanonicalBatchDatabase,
  tenantId: string,
  labTestId: number | null,
): Promise<string | null> {
  if (labTestId == null) return null;
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_catalog_item'
      AND source_type='legacy_lab_test' AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, String(labTestId)).first<MappingRow>();
  if (!mapping || mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('Canonical service mapping not found for doctor commission rule');
  }
  return mapping.canonical_public_id;
}

async function applyCanonicalLiveDoctorCommission(
  db: CanonicalBatchDatabase,
  input: LiveDoctorCommissionAccrualInput,
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<LiveDoctorCommissionCanonicalResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const invoiceSourceLineId = exact(input.invoiceSourceLineId, 'invoiceSourceLineId');
  const sourceKey = exact(input.legacyAccrualSourceKey, 'legacyAccrualSourceKey');
  const billId = positiveInteger(input.billId, 'billId');
  const doctorId = positiveInteger(input.doctorId, 'doctorId');
  const ruleId = positiveInteger(input.rule.id, 'rule.id');
  const doctorDisplayName = exact(input.doctorDisplayName, 'doctorDisplayName');
  const accruedAtUtc = toUtcIso(input.accruedAtUtc);
  if (accruedAtUtc !== input.accruedAtUtc) throw new RangeError('accruedAtUtc must be a normalized UTC ISO timestamp');
  const businessDate = validBusinessDate(input.businessDate);
  if (!input.rule.isActive) throw new Error('Inactive doctor commission rule cannot accrue compensation');
  if (expectedRole(input.rule.incentiveType) !== input.practitionerRole) {
    throw new Error('Legacy commission incentive type does not match canonical practitioner role');
  }

  const legacyGrossMinor = Number(toMinorUnits(input.grossAmount));
  const legacyDiscountMinor = Number(toMinorUnits(input.discountAmount));
  const taxMinor = Number(toMinorUnits(input.taxAmount));
  const performerReserveMinor = Number(toMinorUnits(input.performerReserveAmount));
  const eligibleBaseMinor = Number(toMinorUnits(input.eligibleBaseAmount));
  const cumulativeEligibleBaseBeforeMinor = Number(toMinorUnits(
    input.cumulativeEligibleBaseBeforeAmount ?? 0,
  ));
  const earnedMinor = Number(toMinorUnits(input.earnedAmount));
  const protectedMinor = Number(toMinorUnits(input.protectedAmount ?? 0));
  const waiverCapacityMinor = Number(toMinorUnits(
    input.waiverCapacityAmount ?? ((Number(input.earnedAmount) || 0) - (Number(input.protectedAmount ?? 0) || 0)),
  ));
  const adjustedMinor = Number(toMinorUnits(input.adjustedAmount));
  const requestedWaiverMinor = Number(toMinorUnits(input.requestedWaiverAmount ?? input.adjustedAmount));
  const hospitalFundedOverflowMinor = Number(toMinorUnits(input.hospitalFundedOverflowAmount ?? 0));
  const payableMinor = Number(toMinorUnits(input.payableAmount));
  if (legacyDiscountMinor > legacyGrossMinor) throw new RangeError('Commission discount exceeds gross line amount');
  if (performerReserveMinor > legacyGrossMinor - legacyDiscountMinor) {
    throw new RangeError('Performer reserve exceeds discounted line amount');
  }
  const expectedBaseMinor = legacyGrossMinor - legacyDiscountMinor - performerReserveMinor;
  if (eligibleBaseMinor !== expectedBaseMinor) {
    throw new RangeError('Canonical commission base must equal gross less discount and performer reserve');
  }
  const rate = canonicalRate(input.rule);
  const waiverPolicy = canonicalWaiverPolicy(input.rule, rate);
  if (!Number.isSafeInteger(cumulativeEligibleBaseBeforeMinor) || cumulativeEligibleBaseBeforeMinor < 0) {
    throw new RangeError('Canonical cumulative commission base must be a non-negative safe integer');
  }
  if (earnedMinor !== calculatedEarnedMinor(eligibleBaseMinor, rate, cumulativeEligibleBaseBeforeMinor)) {
    throw new RangeError('Canonical earned commission does not match the cumulative rule allocation');
  }
  if (protectedMinor < 0 || protectedMinor > earnedMinor) {
    throw new RangeError('Canonical protected commission must be between zero and earned commission');
  }
  if (waiverCapacityMinor !== earnedMinor - protectedMinor) {
    throw new RangeError('Canonical waiver capacity must equal earned less protected commission');
  }
  if (adjustedMinor < 0 || adjustedMinor > waiverCapacityMinor || payableMinor !== earnedMinor - adjustedMinor) {
    throw new RangeError('Canonical payable commission must equal earned less an adjustment within waiver capacity');
  }
  if (requestedWaiverMinor < adjustedMinor || hospitalFundedOverflowMinor < 0) {
    throw new RangeError('Canonical requested waiver must cover the applied doctor waiver');
  }

  const invoiceAuthority = await resolveLegacyLiveInvoiceLineAuthority(db, {
    tenantId,
    billId,
    invoiceNo,
    invoiceSourceLineId,
  });
  const invoicePublicId = invoiceAuthority.invoicePublicId;
  const invoiceLinePublicId = invoiceAuthority.invoiceLinePublicId;
  if (invoiceAuthority.invoiceStatus !== 'posted') throw new Error('Canonical invoice is not posted');

  const grossMinor = invoiceAuthority.authority === 'legacy_recovered_net'
    ? invoiceAuthority.lineAmountMinor
    : legacyGrossMinor;
  const discountMinor = invoiceAuthority.authority === 'legacy_recovered_net'
    ? 0
    : legacyDiscountMinor;
  if (invoiceAuthority.lineAmountMinor !== grossMinor) {
    throw new Error('Canonical invoice line gross does not match doctor commission authority');
  }
  if (eligibleBaseMinor !== grossMinor - discountMinor - performerReserveMinor) {
    throw new RangeError('Canonical invoice line authority does not reconcile to the commission base');
  }

  const routeSourceKey = input.doctorCanonicalSourceKey?.trim() || null;
  const practitionerSourcePublicId = routeSourceKey ?? String(doctorId);
  const practitionerPublicId = await mappedPractitionerPublicId(
    db,
    tenantId,
    practitionerSourcePublicId,
  ) ?? await createDeterministicSourceId(
    routeSourceKey ? 'pract' : 'prc',
    tenantId,
    PRACTITIONER_SOURCE_TYPE,
    practitionerSourcePublicId,
  );
  const ruleSourcePublicId = input.rule.canonicalSourceKey?.trim() || String(ruleId);
  const rulePublicId = await createDeterministicSourceId(
    'comprule',
    tenantId,
    RULE_SOURCE_TYPE,
    ruleSourcePublicId,
  );
  const accrualPublicId = await createDeterministicSourceId(
    'compacc',
    tenantId,
    ACCRUAL_SOURCE_TYPE,
    sourceKey,
  );
  const servicePublicId = await mappedServicePublicId(db, tenantId, input.rule.labTestId);
  const categoryKey = servicePublicId == null ? normalizedCategory(input.rule.category) : null;
  const scopeType = servicePublicId != null ? 'service' : categoryKey != null ? 'category' : 'all';
  const calculationBasis = (
    input.rule.serviceType !== 'consultation_fee'
    && (input.practitionerRole === 'referring' || input.practitionerRole === 'prescribing')
  ) ? 'remaining_after_performer' : 'net_after_discount';
  const practitionerEvidence = await createSourceEvidenceSha256({
    sourceType: PRACTITIONER_SOURCE_TYPE,
    sourcePublicId: practitionerSourcePublicId,
    displayName: normalizeIdentityText(doctorDisplayName),
    specialty: normalizeIdentityText(input.doctorSpecialty ?? null),
    department: normalizeIdentityText(input.doctorDepartment ?? null),
    registrationNumber: normalizeRegistrationNumber(input.doctorRegistrationNumber ?? null),
    userId: input.doctorUserId ?? null,
    isActive: input.doctorIsActive,
  });
  const ruleEvidence = await createSourceEvidenceSha256({
    sourceType: RULE_SOURCE_TYPE,
    sourcePublicId: ruleSourcePublicId,
    doctorId,
    serviceType: input.rule.serviceType,
    labTestId: input.rule.labTestId,
    category: input.rule.category,
    incentiveType: input.rule.incentiveType,
    rateType: input.rule.rateType,
    rateValue: input.rule.rateValue,
    waiverPolicy: waiverPolicy.waiverPolicy,
    protectedRateValue: waiverPolicy.protectedRateValue,
    effectiveFrom: input.rule.effectiveFrom,
    effectiveTo: input.rule.effectiveTo,
    isActive: input.rule.isActive ? 1 : 0,
    createdAt: input.rule.createdAt,
    updatedAt: input.rule.updatedAt,
  });
  const latestRule = await db.prepare(`
    SELECT rule_version,source_evidence_sha256
    FROM canonical_compensation_rules
    WHERE tenant_id=? AND rule_public_id=?
    ORDER BY rule_version DESC
    LIMIT 1
  `).bind(tenantId, rulePublicId).first<ExistingCanonicalRuleRow>();
  const reuseRule = latestRule?.source_evidence_sha256 === ruleEvidence;
  const ruleVersion = reuseRule ? latestRule.rule_version : (latestRule?.rule_version ?? 0) + 1;
  const accrualEvidence = await createSourceEvidenceSha256({
    sourceType: ACCRUAL_SOURCE_TYPE,
    sourcePublicId: sourceKey,
    doctorId,
    billId,
    legacySourceType: input.rule.serviceType,
    incentiveType: input.rule.incentiveType,
    grossAmountMajor: grossMinor / 100,
    discountAmountMajor: discountMinor / 100,
    legacyGrossAmountMajor: input.grossAmount,
    legacyDiscountAmountMajor: input.discountAmount,
    lineAuthority: invoiceAuthority.authority,
    commissionRuleId: ruleId,
    commissionRateBps: input.rule.rateType === 'percent' ? input.rule.rateValue : 0,
    commissionFlatAmountMajor: input.rule.rateType === 'flat' ? input.rule.rateValue : 0,
    commissionAmountMajor: input.payableAmount,
    earnedAmountMajor: input.earnedAmount,
    protectedAmountMajor: input.protectedAmount ?? 0,
    waiverCapacityAmountMajor: input.waiverCapacityAmount ?? (Number(input.earnedAmount) - Number(input.protectedAmount ?? 0)),
    requestedWaiverAmountMajor: input.requestedWaiverAmount ?? input.adjustedAmount,
    hospitalFundedOverflowAmountMajor: input.hospitalFundedOverflowAmount ?? 0,
    waiverAmountMajor: input.adjustedAmount,
    payableAmountMajor: input.payableAmount,
    accruedDate: businessDate,
    commissionBaseAmountMajor: input.eligibleBaseAmount,
    cumulativeCommissionBaseBeforeMajor: input.cumulativeEligibleBaseBeforeAmount ?? 0,
    performerReserveAmountMajor: input.performerReserveAmount,
  });
  const status: LiveDoctorCommissionCanonicalResult['status'] = payableMinor > 0 ? 'accrued' : 'settled';
  const result: LiveDoctorCommissionCanonicalResult = {
    accrualPublicId,
    practitionerPublicId,
    rulePublicId,
    ruleVersion,
    invoicePublicId,
    invoiceLinePublicId,
    grossMinor,
    discountMinor,
    performerReserveMinor,
    eligibleBaseMinor,
    earnedMinor,
    protectedMinor,
    waiverCapacityMinor,
    requestedWaiverMinor,
    hospitalFundedOverflowMinor,
    adjustedMinor,
    payableMinor,
    status,
  };

  const reportingContextStatements: CanonicalPreparedStatement[] = input.reportingContext ? [
    await buildCanonicalCompensationReportingContextStatement(db, {
      tenantId,
      accrualPublicId,
      legacyBillId: billId,
      doctorWaiverMinor: adjustedMinor,
      context: input.reportingContext,
    }),
  ] : [];
  const ruleStatements: CanonicalPreparedStatement[] = reuseRule ? [] : [
    db.prepare(`
      INSERT INTO canonical_compensation_rules (
        tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
        practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
        waiver_policy,protected_rate_value,
        calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
        priority,effective_from,effective_to,status,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?, 'commission',?,?,?,?,?,?, 'exclude',0,NULL,20,?,?, 'active',?)
    `).bind(
      tenantId,
      rulePublicId,
      ruleVersion,
      scopeType,
      servicePublicId,
      categoryKey,
      practitionerPublicId,
      input.practitionerRole,
      rate.rateType,
      rate.rateValue,
      waiverPolicy.waiverPolicy,
      waiverPolicy.protectedRateValue,
      calculationBasis,
      'deduct',
      input.rule.effectiveFrom ?? '1970-01-01',
      input.rule.effectiveTo,
      ruleEvidence,
    ),
  ];

  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.compensation.accrue.live',
    idempotencyKey: `${ACCRUAL_SOURCE_TYPE}:${sourceKey}`,
    request: {
      sourceKey,
      invoicePublicId,
      invoiceLinePublicId,
      practitionerPublicId,
      practitionerRole: input.practitionerRole,
      rulePublicId,
      ruleVersion,
      grossMinor,
      discountMinor,
      taxMinor,
      performerReserveMinor,
      eligibleBaseMinor,
      cumulativeEligibleBaseBeforeMinor,
      earnedMinor,
      protectedMinor,
      waiverCapacityMinor,
      requestedWaiverMinor,
      hospitalFundedOverflowMinor,
      adjustedMinor,
      payableMinor,
      accruedAtUtc,
      businessDate,
    },
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES (?,?,?,?,?)
        ON CONFLICT(tenant_id,practitioner_public_id) DO UPDATE SET
          practitioner_kind=excluded.practitioner_kind,
          display_name=excluded.display_name,
          status=excluded.status,
          updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      `).bind(
        tenantId,
        practitionerPublicId,
        input.practitionerKind ?? 'internal',
        doctorDisplayName,
        input.doctorIsActive ? 'active' : 'inactive',
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'practitioner',
        canonicalPublicId: practitionerPublicId,
        sourceType: PRACTITIONER_SOURCE_TYPE,
        sourcePublicId: practitionerSourcePublicId,
        sourceTable: 'doctors',
        evidenceSha256: practitionerEvidence,
      }),
      ...ruleStatements,
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_rule',
        canonicalPublicId: rulePublicId,
        sourceType: RULE_SOURCE_TYPE,
        sourcePublicId: ruleSourcePublicId,
        sourceTable: 'doctor_commission_rules',
        evidenceSha256: ruleEvidence,
      }),
      db.prepare(`
        INSERT INTO canonical_compensation_accruals (
          tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
          service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
          rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
          gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
          earned_minor,protected_minor,waiver_capacity_minor,requested_waiver_minor,
          hospital_funded_overflow_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
          business_date,payable_projection_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,NULL,?,?, 'commission',?,?,?,?,?,'BDT',?,?,?,?,?,?,?,?,?,?,?,0,?,?,?, ?,1,?)
      `).bind(
        tenantId,
        accrualPublicId,
        invoicePublicId,
        invoiceLinePublicId,
        practitionerPublicId,
        input.practitionerRole,
        rulePublicId,
        ruleVersion,
        calculationBasis,
        rate.rateType,
        rate.rateValue,
        grossMinor,
        discountMinor,
        taxMinor,
        performerReserveMinor,
        eligibleBaseMinor,
        earnedMinor,
        protectedMinor,
        waiverCapacityMinor,
        requestedWaiverMinor,
        hospitalFundedOverflowMinor,
        adjustedMinor,
        payableMinor,
        status,
        accruedAtUtc,
        businessDate,
        accrualEvidence,
      ),
      ...reportingContextStatements,
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_accrual',
        canonicalPublicId: accrualPublicId,
        sourceType: ACCRUAL_SOURCE_TYPE,
        sourcePublicId: sourceKey,
        sourceTable: 'doctor_commission_accruals',
        evidenceSha256: accrualEvidence,
      }),
    ],
    result,
    event: {
      eventPublicId: await createDeterministicSourceId('outevt', tenantId, ACCRUAL_SOURCE_TYPE, sourceKey),
      aggregateType: 'compensation_accrual',
      aggregatePublicId: accrualPublicId,
      eventType: 'canonical.compensation.accrued',
      payload: {
        accrualPublicId,
        invoiceLinePublicId,
        practitionerPublicId,
        practitionerRole: input.practitionerRole,
        earnedMinor,
        protectedMinor,
        waiverCapacityMinor,
        requestedWaiverMinor,
        hospitalFundedOverflowMinor,
        adjustedMinor,
        payableMinor,
        currencyCode: 'BDT',
      },
      occurredAtUtc: accruedAtUtc,
      businessDate,
    },
  });
}

export async function executeLiveDoctorCommissionAccrual(
  db: CanonicalBatchDatabase,
  input: LiveDoctorCommissionAccrualInput,
): Promise<LiveDoctorCommissionExecution> {
  return executeStrictFinancialMutation({
    db,
    tenantId: input.tenantId,
    boundary: 'doctor-compensation.accrue',
    legacyStatements: [input.legacyStatement],
    canonical: (execution) => applyCanonicalLiveDoctorCommission(db, input, execution),
  });
}
